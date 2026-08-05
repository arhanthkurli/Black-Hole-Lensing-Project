#%%
import numpy as np
from scipy.integrate import solve_ivp
from scipy.spatial.transform import Rotation
import sympy as sp
import json
from time import time
from concurrent.futures import ProcessPoolExecutor

with open('christoffels.json') as file:
    christoffel_dict = json.load(file)

nonzero_index = christoffel_dict['index']
nonzero_value = [sp.sympify(item) for item in christoffel_dict['value']]
symbols = sorted(set().union(*[expr.free_symbols for expr in nonzero_value]), key = str)

#Positional Parameters
source_position = (-50.0, 0.0, 0.0)
x_screen = 30.0

#Adjustable Constants
G, M, a = 1.0, 0.5, 0.25

r_plus = M + np.sqrt(M**2 - a**2)
r_cut = 1.10 * r_plus
R_escape = 80

Gamma = None

print('Parameters defined')

def init_worker():
    global Gamma
    Gamma = sp.lambdify(symbols, nonzero_value, 'numpy', cse = True)
    print('Worker ready')

#%%

def trajectory(tau, state):
    x, y, z = state[1], state[2], state[3]
    u = state[4:8]
    du = [0.0 for _ in range(4)]
    Gamma_result = Gamma(a, x, y, z)
    for (mu, alpha, beta), value in zip(nonzero_index, Gamma_result):
        symmetry_factor = 1 if alpha == beta else 2
        du[mu] -= symmetry_factor * value * u[alpha] * u[beta]
    return np.concatenate((u, du))

print('Trajectory defined')

#Defining Events

def hit_screen(t, state):
    return state[1] - x_screen
hit_screen.terminal = True

def escape_sphere(t,state):
    return state[1]**2 + state[2]**2 + state[3]**2 - R_escape**2
escape_sphere.terminal = True

def hit_object(t, state):
    return state[1]**2 + state[2]**2 + state[3]**2 - r_cut**2
hit_object.terminal = True

print('Events defined')

def single_ray(job):
    i_theta, i_phi, state0 = job
    sol = solve_ivp(trajectory, (0, 400), state0,
                    events=[hit_screen, escape_sphere, hit_object],
                    atol=1e-13, rtol=1e-11, max_step=0.1)
    absorbed = len(sol.t_events[2]) > 0
    if sol.y_events[0].size:
        yv = sol.y_events[0][0]
        hit = (float(yv[2]), float(yv[3]), float(i_theta), float(i_phi))
    else:
        hit = None
    return hit

if __name__ == '__main__':
    r_source = np.linalg.norm(source_position)
    Rot, _ = Rotation.align_vectors([-np.array(source_position)/r_source], [[1, 0, 0]])

    N_theta = 40
    N_phi = 2
    b = 5.196*M + np.logspace(np.log10(0.003), np.log10(2), N_theta)
    theta_values = np.arcsin(b/r_source)
    phi_values = np.linspace(0, 2*np.pi, N_phi, endpoint=False)

    jobs = []
    for i_theta, angle_theta in enumerate(theta_values):
        for i_phi, angle_phi in enumerate(phi_values):
            vx0 = np.cos(angle_theta)
            vy0 = np.sin(angle_theta)*np.cos(angle_phi)
            vz0 = np.sin(angle_theta)*np.sin(angle_phi)
            v_car = Rot.apply([vx0, vy0, vz0])
            state0 = [0, source_position[0], source_position[1], source_position[2],
                      1, v_car[0], v_car[1], v_car[2]]
            jobs.append((i_theta, i_phi, state0))

            print (f'{len(jobs)} built')

    hit_points = []

    print('Pool begins')

    with ProcessPoolExecutor(initializer=init_worker) as executor:
        for n, hit in enumerate(executor.map(single_ray, jobs, chunksize=16)):
            if hit is not None:
                hit_points.append(hit)
            if n % 100 == 0:
                print(f'{n}/{len(jobs)} completed')

    print(f'All jobs completed. {len(hit_points)} hit-points.')
    with open('Kerr-schild.json', 'w') as outfile:
        json.dump(hit_points, outfile)

print('Done')


# %%
