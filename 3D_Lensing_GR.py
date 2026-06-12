import numpy as np
from scipy.integrate import solve_ivp
from scipy.spatial.transform import Rotation
import sympy as sp
import matplotlib.pyplot as plt

#Positional Parameters
source_position = (-50.0, 0.0, 0.0)
x_screen = 30.0

#Adjustable Constants
G, c, M_lens = 1.0, 1.0, 0.5
R_s = 2*G*M_lens/(c**2)
R_lens = 1.05 * R_s

#Schwarzchild Setup
t_sym, r_sym, theta_sym, phi_sym = sp.symbols('t r theta phi')
g = sp.Matrix([[-(1 - R_s/r_sym)*c**2, 0, 0, 0], 
               [0, 1/(1 - R_s/r_sym), 0, 0], 
               [0, 0, r_sym**2, 0], 
               [0, 0, 0, r_sym**2 * sp.sin(theta_sym)**2]])
g_inv = g.inv()
sc_components = [sp.lambdify([r_sym, theta_sym], g[i, i], 'numpy') for i in range(4)]

#Computing christoffels
def compute_christoffel():
    coords = [t_sym, r_sym, theta_sym, phi_sym]
    out = [[[0 for _ in range(4)] for _ in range (4)] for _ in range(4)]
    for mu in range(4):
        for alpha in range(4):
            for beta in range(4):
                total = 0
                for lmbda in range(4):
                    total += 0.5 *g_inv[mu, lmbda] * (sp.diff(g[lmbda, beta], coords[alpha]) + 
                                                            sp.diff(g[lmbda, alpha], coords[beta]) - 
                                                            sp.diff(g[alpha, beta], coords[lmbda]))
                out[mu][alpha][beta] = sp.simplify(total)
    return out

result = compute_christoffel()

#Setting up Gamma function
nonzero_index, nonzero_value = [], []
for mu in range(4):
    for alpha in range(4):
        for beta in range (4):
            if result[mu][alpha][beta] != 0:
                nonzero_index.append((mu, alpha, beta))
                nonzero_value.append(result[mu][alpha][beta])

Gamma = sp.lambdify([r_sym, theta_sym], nonzero_value, 'numpy')

#Defining Trajectories
def trajectory(tau, state):
    r, theta = state[1], state[2]
    u = state[4:8]
    du = [0.0 for _ in range(4)]
    Gamma_result = Gamma(r, theta)
    for (mu, a, b), value in zip(nonzero_index, Gamma_result):
        du[mu] -= value * u[a] * u[b]
    return np.concatenate((u, du))

#Defining Events
def hit_screen(t, state):
    return state[1]*np.sin(state[2])*np.cos(state[3]) - x_screen
hit_screen.terminal = True

def hit_object(t, state):
    return state[1] - R_lens
hit_object.terminal = True

x_sym, y_sym, z_sym = sp.symbols('x y z')
r = sp.sqrt(x_sym**2 + y_sym**2 + z_sym**2) 

car = [x_sym, y_sym, z_sym]
sph = [r, sp.acos(z_sym/r), sp.atan2(y_sym, x_sym)]

J = sp.lambdify([x_sym, y_sym, z_sym], 
                [[sp.diff(sph[s], car[k]) for k in range(3)] for s in range(3)], 'numpy')

r_source = np.linalg.norm(source_position)
theta_source = np.arccos(source_position[2]/r_source)
phi_source = np.arctan2(source_position[1], source_position[0])

sc_list = [comp(r_source, theta_source) for comp in sc_components]
Rot, _ = Rotation.align_vectors([-np.array(source_position) / r_source], [[1, 0, 0]])

#Adjustable Parameters
v = 1.0
N_theta = 40
N_phi = 60
theta_min = np.arcsin(2.4 * R_s/r_source)
theta_max = np.arcsin(30.0 * R_s/r_source)

b = 2.598 * R_s + np.logspace(np.log10(0.003), np.log10(2), N_theta)
theta_values = np.arcsin(b/r_source)
phi_values = np.linspace(0, 2*np.pi, N_phi, endpoint=False)

trajectories = []
gradient_map = []

for i_theta, angle_theta in enumerate(theta_values):
    for i_phi, angle_phi in enumerate(phi_values):

        vx0 = v * np.cos(angle_theta)
        vy0 = v * np.cos(angle_phi) * np.sin(angle_theta)
        vz0 = v * np.sin(angle_phi) * np.sin(angle_theta)

        v_car = Rot.apply([vx0, vy0, vz0])
        v_sph = np.dot(J(source_position[0], source_position[1], source_position[2]), v_car)
        ut = np.sqrt(-(sc_list[1]*v_sph[0]**2 + sc_list[2]*v_sph[1]**2 + sc_list[3]*v_sph[2]**2)/sc_list[0])
        state0 = [0, r_source, theta_source, phi_source, ut, v_sph[0], v_sph[1], v_sph[2]] 

        sol = solve_ivp(trajectory, (0,400), state0, 
                        events = [hit_screen, hit_object], 
                        atol = 1e-6, rtol = 1e-6, max_step = 0.1)
        
        trajectories.append({'sol': sol,
                            'i_theta': i_theta, 'i_phi': i_phi,
                            'theta': angle_theta, 'phi': angle_phi,
                            'absorbed': len(sol.t_events[1]) > 0})
    

def plot_trajectories(trajs, R_s):
    fig, ax = plt.subplots(figsize=(8, 8))
    for t in trajs:
        sol = t['sol']
        r, theta, phi = sol.y[1], sol.y[2], sol.y[3]
        x = r * np.sin(theta) * np.cos(phi)
        y = r * np.sin(theta) * np.sin(phi)
        if not t['absorbed']:
            ax.plot(x, y, lw=0.8)
    
    ax.add_patch(plt.Circle((0, 0), R_s, color='k'))
    ax.add_patch(plt.Circle((0, 0), 1.5 * R_s, color='orange', fill=False, ls='--'))

    ax.set_xlim(-5, 5); ax.set_ylim(-5, 5)
    ax.set_aspect('equal'); ax.set_xlabel('x'); ax.set_ylabel('y')
    plt.show()

trajs = [t for t in trajectories if t['i_phi'] == 0 and 
                                    t['i_theta'] in (1, 2, 3, 6, 8, 13)]

plot_trajectories(trajs, R_s)



