#%%
import numpy as np
from scipy.integrate import solve_ivp
from scipy.spatial.transform import Rotation
import sympy as sp
import matplotlib.pyplot as plt
import json
from time import time

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
# Set the spin to 0 for testing
G, M, a = 1.0, 0.5, 0.0

r_plus = M + np.sqrt(M**2 - a**2)
r_cut = 1.10 * r_plus
R_escape = 80

print('Gamma lambdification begins')

Gamma = sp.lambdify(symbols, nonzero_value, 'numpy', cse = True)

#%%
print('Gamma lambdified')

def trajectory(tau, state):
    x, y, z = state[1], state[2], state[3]
    u = state[4:8]
    du = [0.0 for _ in range(4)]
    Gamma_result = Gamma(x, y, z)
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

r_source = np.linalg.norm(source_position)
Rot, _ = Rotation.align_vectors([-np.array(source_position) / r_source], [[1, 0, 0]])

#Adjustable Parameters
N_theta = 40
N_phi = 60

b = 5.196 * M + np.logspace(np.log10(0.003), np.log10(2), N_theta)
theta_values = np.arcsin(b/r_source)
phi_values = np.linspace(0, 2*np.pi, N_phi, endpoint=False)

trajectories = []
hit_points = []
gradient_map = []

print('Trajecotry computation begins')

for i_theta, angle_theta in enumerate(theta_values):
    for i_phi, angle_phi in enumerate(phi_values):

        vx0 = np.cos(angle_theta)
        vy0 = np.sin(angle_theta) * np.cos(angle_phi)
        vz0 = np.sin(angle_theta) * np.sin(angle_phi)
        v_car = Rot.apply([vx0, vy0, vz0])

        state0 = [0, source_position[0], source_position[1], source_position[2], 1, v_car[0], v_car[1], v_car[2]] 

        sol = solve_ivp(trajectory, (0,400), state0, 
                        events = [hit_screen, escape_sphere, hit_object], 
                        atol = 1e-13, rtol = 1e-11, max_step = 0.1)
        
        trajectories.append({'sol': sol,
                            'i_theta': i_theta, 'i_phi': i_phi,
                            'theta': angle_theta, 'phi': angle_phi,
                            'absorbed': len(sol.t_events[2]) > 0})

        if sol.y_events[0].size: hit_points.append((float(sol.y_events[0][0][2]), 
                                                    float(sol.y_events[0][0][3]), 
                                                    float(i_theta), 
                                                    float(i_phi)))

    print(f'Angle {i_theta} of {N_theta} completed')

print('Trajectories and hit points computed')

with open('Kerr-schild.json', 'w') as outfile:
    json.dump(hit_points, outfile)

print('Json dump completed')

# def plot_trajectories(trajs, R_s):
#     fig, ax = plt.subplots(figsize=(8, 8))
#     for t in trajs:
#         sol = t['sol']
#         x = sol.y[1]
#         y = sol.y[2]
#         if not t['absorbed']:
#             ax.plot(x, y, lw=0.8)
    
#     ax.add_patch(plt.Circle((0, 0), R_s, color='k'))
#     ax.add_patch(plt.Circle((0, 0), 1.5 * R_s, color='orange', fill=False, ls='--'))

#     ax.set_xlim(-5, 5); ax.set_ylim(-5, 5)
#     ax.set_aspect('equal'); ax.set_xlabel('x'); ax.set_ylabel('y')
#     plt.show()

# trajs = [t for t in trajectories if t['i_phi'] == 0 and 
#                                     t['i_theta'] in (1, 2, 3, 6, 8, 13)]

# plot_trajectories(trajs, 2*M)

#print('Trajectories plotted')






# %%
