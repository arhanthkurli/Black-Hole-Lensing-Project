#%%
import numpy as np
import json
import os
import time
import sympy as sp
from concurrent.futures import ProcessPoolExecutor
from scipy.integrate import solve_ivp
from scipy.spatial.transform import Rotation


def log(message):
    print(f"[Kerr-Schild] {message}", flush=True)
#%%
#Positional Parameters
source_position = (-50.0, 0.0, 0.0)
x_screen = 30.0

#Adjustable Constants. Coordinates use geometric units; M and a are lengths
#when G = c = 1.
G, c, M, a = 1.0, 1.0, 0.5, 0.25
mass_length = G * M / c**2

if mass_length <= 0:
    raise ValueError("M must be positive.")
if abs(a) > mass_length:
    raise ValueError("Kerr black holes require |a| <= G*M/c^2.")

r_plus = mass_length + np.sqrt(mass_length**2 - a**2)
r_cut = 1.10 * r_plus

log(f"source={source_position}, screen x={x_screen}")
log(f"mass length={mass_length:.6g}, spin a={a:.6g}, r_plus={r_plus:.6g}, cutoff r={r_cut:.6g}")

eta = np.diag([-1.0, 1.0, 1.0, 1.0])


def kerr_schild_radius(x_val, y_val, z_val):
    R2 = x_val**2 + y_val**2 + z_val**2
    return np.sqrt((R2 - a**2 + np.sqrt((R2 - a**2)**2 + 4.0 * a**2 * z_val**2)) / 2.0)


def metric(x_val, y_val, z_val):
    r_val = kerr_schild_radius(x_val, y_val, z_val)
    if r_val <= 0.0:
        raise ValueError("Kerr-Schild radius reached zero.")

    denom = r_val**2 + a**2
    f_val = 2.0 * mass_length * r_val**3 / (r_val**4 + a**2 * z_val**2)
    k_vec = np.array([
        1.0,
        (r_val * x_val + a * y_val) / denom,
        (r_val * y_val - a * x_val) / denom,
        z_val / r_val,
    ])
    return eta + f_val * np.outer(k_vec, k_vec)


def build_christoffel_function():
    """Build exact Christoffels without generic inversion or simplification."""
    build_start = time.perf_counter()
    t_sym, x_sym, y_sym, z_sym = sp.symbols("t x y z", real=True)
    coords = (t_sym, x_sym, y_sym, z_sym)

    R2_sym = x_sym**2 + y_sym**2 + z_sym**2
    r_sym = sp.sqrt(
        (R2_sym - a**2
         + sp.sqrt((R2_sym - a**2)**2 + 4.0 * a**2 * z_sym**2)) / 2.0
    )
    eta_sym = sp.diag(-1, 1, 1, 1)
    f_sym = 2.0 * mass_length * r_sym**3 / (r_sym**4 + a**2 * z_sym**2)
    k_cov = sp.Matrix([
        1,
        (r_sym * x_sym + a * y_sym) / (r_sym**2 + a**2),
        (r_sym * y_sym - a * x_sym) / (r_sym**2 + a**2),
        z_sym / r_sym,
    ])
    g_sym = eta_sym + f_sym * k_cov * k_cov.T

    # For a Kerr-Schild metric, k is eta-null and the inverse is exact.
    # This replaces the extremely expensive generic SymPy g.inv().
    k_contra = eta_sym * k_cov
    g_inv_sym = eta_sym - f_sym * k_contra * k_contra.T

    # Cache derivatives: the original loop asked SymPy for the same ones often.
    dg = [[[sp.diff(g_sym[i, j], coords[p]) for j in range(4)]
           for i in range(4)] for p in range(4)]

    gamma_expr = []
    half = sp.Rational(1, 2)
    for mu in range(4):
        for alpha in range(4):
            for beta in range(4):
                gamma_expr.append(sum(
                    half * g_inv_sym[mu, lam] * (
                        dg[alpha][lam][beta]
                        + dg[beta][lam][alpha]
                        - dg[lam][alpha][beta]
                    )
                    for lam in range(4)
                ))

    # CSE is much faster here than separately simplifying all 64 expressions,
    # and it also makes each numerical evaluation substantially cheaper.
    gamma_flat = sp.lambdify(
        (x_sym, y_sym, z_sym), gamma_expr, modules="numpy", cse=True
    )
    log(f"built exact CSE Christoffels in {time.perf_counter() - build_start:.3f} s")
    return gamma_flat


Gamma_flat = build_christoffel_function()


def christoffel(x_val, y_val, z_val):
    return np.asarray(Gamma_flat(x_val, y_val, z_val), dtype=float).reshape(4, 4, 4)


def solve_future_null_ut(metric, spatial_u):
    spatial_u = np.asarray(spatial_u, dtype=float)
    A = float(metric[0, 0])
    B = float(2.0 * metric[0, 1:4] @ spatial_u)
    C = float(spatial_u @ metric[1:4, 1:4] @ spatial_u)

    if np.isclose(A, 0.0):
        if np.isclose(B, 0.0):
            raise ValueError("Degenerate null solve for initial tangent.")
        root = -C / B
        if root <= 0.0:
            raise ValueError(f"No future-directed null root for u^t; root={root}")
        return root

    discriminant = B**2 - 4.0 * A * C
    if discriminant < 0.0 and np.isclose(discriminant, 0.0, atol=1e-12):
        discriminant = 0.0
    if discriminant < 0.0:
        raise ValueError(f"Initial tangent cannot be made null; discriminant={discriminant}")

    sqrt_disc = np.sqrt(discriminant)
    roots = [(-B + sqrt_disc) / (2.0 * A), (-B - sqrt_disc) / (2.0 * A)]
    future_roots = [root for root in roots if root > 0.0]
    if not future_roots:
        raise ValueError(f"No future-directed null root for u^t; roots={roots}")
    return max(future_roots)

#%%
def trajectory(tau, state):
    x, y, z = state[1], state[2], state[3]
    u = state[4:8]
    Gamma_result = christoffel(x, y, z)
    du = -np.einsum("mab,a,b->m", Gamma_result, u, u)
    return np.concatenate((u, du))


def null_residual(state):
    position = state[1:4]
    u = state[4:8]
    return float(u @ metric(*position) @ u)

#Defining Events
def hit_screen(t, state):
    return state[1] - x_screen
hit_screen.terminal = True
hit_screen.direction = 1

def hit_object(t, state):
    return kerr_schild_radius(state[1], state[2], state[3]) - r_cut
hit_object.terminal = True
hit_object.direction = -1

def escaped(t, state):
    return kerr_schild_radius(state[1], state[2], state[3]) - escape_radius
escaped.terminal = True
escaped.direction = 1

r_source = np.linalg.norm(source_position)
Rot, _ = Rotation.align_vectors([-np.array(source_position) / r_source], [[1, 0, 0]])
#%%
#Adjustable Parameters
N_theta = 40
N_phi = 60
impact_min = 4.0 * mass_length
impact_max = 20.0 * mass_length
escape_radius = 1.6 * r_source
max_integration_step = 1.0
solver_method = "DOP853"
solver_atol = 1e-13
solver_rtol = 1e-11
save_run_json = False
run_json_path = "3D_Lensing_Kerr-Schild_run.json"

if impact_max >= r_source:
    raise ValueError("impact_max must be smaller than the source distance.")

b_values = np.geomspace(impact_min, impact_max, N_theta)
theta_values = np.arcsin(b_values/r_source)
phi_values = np.linspace(0, 2*np.pi, N_phi, endpoint=False)

trajectories = []
gradient_map = []

g_src = metric(*source_position)
log("checking one Christoffel evaluation at the source")
Gamma_src = christoffel(*source_position)
log(f"source Christoffel max |Gamma|={np.max(np.abs(Gamma_src)):.3e}")
total_rays = N_theta * N_phi
progress_every = 10
parallel_workers = min(8, max(1, (os.cpu_count() or 2) - 1))

def integrate_ray(task):
    i_theta, i_phi, angle_theta, angle_phi = task

    vx0 = np.cos(angle_theta)
    vy0 = np.sin(angle_theta) * np.cos(angle_phi)
    vz0 = np.sin(angle_theta) * np.sin(angle_phi)
    v_car = Rot.apply([vx0, vy0, vz0])
    ut0 = solve_future_null_ut(g_src, v_car)

    state0 = [0, source_position[0], source_position[1], source_position[2],
              ut0, v_car[0], v_car[1], v_car[2]]

    sol = solve_ivp(trajectory, (0, 400), state0,
                    method=solver_method,
                    events=[hit_screen, hit_object, escaped],
                    atol=solver_atol, rtol=solver_rtol,
                    max_step=max_integration_step)

    hit_screen_event = len(sol.t_events[0]) > 0
    absorbed = len(sol.t_events[1]) > 0
    escaped_event = len(sol.t_events[2]) > 0
    if absorbed:
        outcome = "absorbed"
    elif escaped_event:
        outcome = "escaped"
    elif hit_screen_event:
        outcome = "screen"
    else:
        outcome = "unfinished"

    sampled_null_residuals = [abs(null_residual(sol.y[:, i]))
                              for i in range(sol.y.shape[1])]

    return {"sol": sol,
            "i_theta": i_theta, "i_phi": i_phi,
            "theta": angle_theta, "phi": angle_phi,
            "impact": b_values[i_theta],
            "hit_screen": hit_screen_event,
            "escaped": escaped_event,
            "absorbed": absorbed,
            "max_abs_null_residual": max(sampled_null_residuals),
            "outcome": outcome}


tasks = [(i_theta, i_phi, float(angle_theta), float(angle_phi))
         for i_theta, angle_theta in enumerate(theta_values)
         for i_phi, angle_phi in enumerate(phi_values)]

#%%
def trajectory_to_json(record):
    sol = record["sol"]
    return {
        "i_theta": int(record["i_theta"]),
        "i_phi": int(record["i_phi"]),
        "theta": float(record["theta"]),
        "phi": float(record["phi"]),
        "impact": float(record["impact"]),
        "outcome": record["outcome"],
        "hit_screen": bool(record["hit_screen"]),
        "escaped": bool(record["escaped"]),
        "absorbed": bool(record["absorbed"]),
        "max_abs_null_residual": float(record["max_abs_null_residual"]),
        "solver_status": int(sol.status),
        "solver_message": str(sol.message),
        "t": sol.t.tolist(),
        "y": sol.y.tolist(),
        "t_events": [event.tolist() for event in sol.t_events],
        "y_events": [event.tolist() for event in sol.y_events],
    }


def save_run(path, trajs, summary, workers):
    payload = {
        "metadata": {
            "source_position": list(source_position),
            "x_screen": float(x_screen),
            "G": float(G),
            "c": float(c),
            "M": float(M),
            "a": float(a),
            "mass_length": float(mass_length),
            "r_plus": float(r_plus),
            "r_cut": float(r_cut),
            "N_theta": int(N_theta),
            "N_phi": int(N_phi),
            "impact_min": float(impact_min),
            "impact_max": float(impact_max),
            "escape_radius": float(escape_radius),
            "max_integration_step": float(max_integration_step),
            "parallel_workers": int(workers),
            "solver_method": solver_method,
            "atol": float(solver_atol),
            "rtol": float(solver_rtol),
            "christoffel_method": "exact-symbolic-cse"
        },
        "summary": summary,
        "trajectories": [trajectory_to_json(record) for record in trajs]
    }

    log(f"saving run data to {path}")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, separators=(",", ":"))
    log(f"saved {len(trajs)} trajectories to {path}")

def plot_trajectories(trajs, R_s):
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots(figsize=(8, 8))
    for t in trajs:
        sol = t['sol']
        x = sol.y[1]
        y = sol.y[2]
        if not t['absorbed']:
            ax.plot(x, y, lw=0.8)
    
    ax.add_patch(plt.Circle((0, 0), R_s, color='k'))
    ax.add_patch(plt.Circle((0, 0), 1.5 * R_s, color='orange', fill=False, ls='--'))

    ax.set_xlim(-5, 5); ax.set_ylim(-5, 5)
    ax.set_aspect('equal'); ax.set_xlabel('x'); ax.set_ylabel('y')
    plt.show()

def iter_integrated_rays(ray_tasks, workers):
    if workers == 1:
        yield from map(integrate_ray, ray_tasks)
        return

    chunksize = max(1, len(ray_tasks) // (workers * 8))
    with ProcessPoolExecutor(max_workers=workers) as pool:
        yield from pool.map(integrate_ray, ray_tasks, chunksize=chunksize)


def main():
    run_start = time.perf_counter()
    workers = min(parallel_workers, total_rays)
    log(f"integrating {total_rays} rays ({N_theta} impact samples x {N_phi} azimuths) with {workers} worker process(es)")

    row_screen = np.zeros(N_theta, dtype=int)
    row_absorbed = np.zeros(N_theta, dtype=int)
    row_escaped = np.zeros(N_theta, dtype=int)
    row_unfinished = np.zeros(N_theta, dtype=int)
    max_null_residual = 0.0

    for completed, record in enumerate(iter_integrated_rays(tasks, workers), start=1):
        trajectories.append(record)
        i_theta = record["i_theta"]
        if record["outcome"] == "screen":
            row_screen[i_theta] += 1
        elif record["outcome"] == "absorbed":
            row_absorbed[i_theta] += 1
        elif record["outcome"] == "escaped":
            row_escaped[i_theta] += 1
        else:
            row_unfinished[i_theta] += 1
        max_null_residual = max(max_null_residual, record["max_abs_null_residual"])

        if completed == 1 or completed % progress_every == 0 or completed == total_rays:
            log(f"completed ray {completed}/{total_rays}: i_theta={record['i_theta']}, i_phi={record['i_phi']}, outcome={record['outcome']}")
        if completed % N_phi == 0:
            log(f"row {i_theta + 1:02d}/{N_theta}: b={b_values[i_theta]:.6g}, screen={row_screen[i_theta]:02d}, absorbed={row_absorbed[i_theta]:02d}, escaped={row_escaped[i_theta]:02d}, unfinished={row_unfinished[i_theta]:02d}")

    trajectories.sort(key=lambda record: (record["i_theta"], record["i_phi"]))
    summary = {
        "total_rays": int(total_rays),
        "screen": int(row_screen.sum()),
        "absorbed": int(row_absorbed.sum()),
        "escaped": int(row_escaped.sum()),
        "unfinished": int(row_unfinished.sum()),
        "max_abs_null_residual": float(max_null_residual),
    }
    log(f"done in {time.perf_counter() - run_start:.3f} s: "
        f"screen={summary['screen']}, absorbed={summary['absorbed']}, "
        f"escaped={summary['escaped']}, unfinished={summary['unfinished']}, "
        f"max |g(u,u)|={max_null_residual:.3e}")

    if save_run_json:
        save_run(run_json_path, trajectories, summary, workers)

    plot_trajs = [record for record in trajectories
                  if record['i_phi'] == 0
                  and record['i_theta'] in (1, 2, 3, 6, 8, 13)]
    plot_trajectories(plot_trajs, 2 * mass_length)


if __name__ == "__main__":
    main()




