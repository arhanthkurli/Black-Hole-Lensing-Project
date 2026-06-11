import numpy as np
from scipy.integrate import solve_ivp
from scipy.spatial.transform import Rotation
import sympy as sp
import matplotlib.pyplot as plt

source_position = (-50.0, 0.0, 0.0)
x_screen = 30.0

theta_spread = np.radians(15)
plot_half_side = 3
N = 50


R_lens = 1.05
v = 1.0
G = 1
c = 1
M_lens = 1
R_s = 2*G*M_lens/(c**2)

t_sym, r_sym, theta_sym, phi_sym = sp.symbols('t r theta phi')

g = sp.Matrix([[-(1 - R_s/r_sym)*c**2, 0, 0, 0], [0, 1/(1 - R_s/r_sym), 0, 0], [0, 0, r_sym**2, 0], [0, 0, 0, r_sym**2 * sp.sin(theta_sym)**2]])
g_inv = g.inv()

sc_components = [sp.lambdify([r_sym, theta_sym], g[i][i], 'numpy') for i in range(4)]

def compute_christoffel():
    coords = [t_sym, r_sym, theta_sym, phi_sym]
    christoffel_list = [[[0 for i in range(4)] for i in range (4)] for i in range(4)]
    for mu in range(4):
        for alpha in range(4):
            for beta in range(4):
                total = 0
                for lmbda in range(4):
                    christoffel = 0.5 *g_inv[mu, lmbda] * (sp.diff(g[lmbda, beta], coords[alpha]) + 
                                                            sp.diff(g[lmbda, alpha], coords[beta]) - 
                                                            sp.diff(g[alpha, beta], coords[lmbda]))
                    total += sp.simplify(christoffel)
                christoffel_list[mu][alpha][beta] = total
    return christoffel_list

result = compute_christoffel()
Gamma = sp.lambdify([r_sym, theta_sym], result, 'numpy')

def trajectory(tau, state):
    t, r, theta, phi,  ut, ur, utheta, uphi = state
    u_list = [ut, ur, utheta, uphi]
    dt_dtau = ut
    dr_dtau = ur
    dtheta_dtau = utheta
    dphi_dtau = uphi

    du_dtau = []
    Gamma_result = np.array(Gamma(r, theta))
    for mu in range(4):
        sum = 0
        for alpha in range(4):
            for beta in range(4):
                sum += -Gamma_result[mu][alpha][beta] * u_list[alpha] * u_list[beta]
        du_dtau.append(sum)
    
    return [dt_dtau, dr_dtau, dtheta_dtau, dphi_dtau] + du_dtau

def hit_screen(t, state):
    return state[1]*np.sin(state[2])*np.cos(state[3]) - x_screen

hit_screen.terminal = True

def hit_object(t, state):
    return state[1] - R_lens

hit_object.terminal = True

#theta_values = np.linspace(np.arctan(R_lens/np.linalg.norm(source_position)), theta_spread, N)
theta_values = np.linspace(theta_spread, np.arctan(R_lens/np.linalg.norm(source_position)), N)

Rot, _ = Rotation.align_vectors([ - np.array(source_position) / np.linalg.norm(source_position)], [[1, 0, 0]])

x_sym, y_sym, z_sym = sp.symbols('x y z')
r = sp.sqrt(x_sym**2 + y_sym**2 + z_sym**2) 
theta = sp.acos(z_sym/r)
phi = sp.atan2(y_sym, x_sym)

cartesian_list = [x_sym, y_sym, z_sym]
spherical_list = [r, theta, phi]
J = [[0 for i in range(3)] for i in range(3)]

for cartesian in range(3):
    for spherical in range(3):
        J[spherical][cartesian] = sp.diff(spherical_list[spherical], cartesian_list[cartesian])

J = sp.lambdify([x_sym, y_sym, z_sym], J, 'numpy')

r_source = np.sqrt(source_position[0]**2 + source_position[1]**2 + source_position[2]**2) 
theta_source = np.arccos(source_position[2]/r_source)
phi_source = np.arctan2(source_position[1], source_position[0])

sc_list = []
for component in sc_components:
    sc_list.append(component(r_source, theta_source))

trajectories = []
hits = []
gradient_map = []
absorbed = []

for angle_theta in theta_values:
    for angle_phi in np.linspace(0, 2 * np.pi, 100):
        vx0 = v * np.cos(angle_theta)
        vy0 = v * np.cos(angle_phi) * np.sin(angle_theta)
        vz0 = v * np.sin(angle_phi) * np.sin(angle_theta)

        v_cartesian = Rot.apply([vx0, vy0, vz0])
        v_spherical = np.dot(J(source_position[0], source_position[1], source_position[2]), v_cartesian)

        ut = np.sqrt(-(sc_list[1]*v_spherical[0]**2 + sc_list[2]*v_spherical[1]**2 + sc_list[3]*v_spherical[2]**2)/sc_list[0])

        state0 = [0, r_source, theta_source, phi_source, ut, v_spherical[0], v_spherical[1], v_spherical[2]] 

        sol = solve_ivp(trajectory, (0,100), state0, 
                        events = [hit_screen, hit_object], atol = 1e-6, rtol = 1e-6)
        if len(sol.t_events[1]) == 0:
            trajectories.append((sol, angle_theta))

        if len(sol.t_events[0]) > 0 and len(sol.t_events[1]) == 0:
            r_hit = sol.y_events[0][0][1]
            theta_hit = sol.y_events[0][0][2]
            phi_hit = sol.y_events[0][0][3]
            gradient_map.append((r_hit, theta_hit, phi_hit, angle_theta, angle_phi))
    
    if len(sol.t_events[1]) > 0:
        absorbed.append((sol, angle_theta))
    

def plot_trajectories(sols, R_s):
    fig, ax = plt.subplots(figsize=(8, 8))
    for sol in sols:
        r, theta, phi = sol.y[1], sol.y[2], sol.y[3]
        x = r * np.sin(theta) * np.cos(phi)
        y = r * np.sin(theta) * np.sin(phi)
        ax.plot(x, y, lw=0.8)

    ax.set_aspect('equal')
    ax.set_xlabel('x'); ax.set_ylabel('y')
    plt.show()



# #Trajectory Plotting
# fig = plt.figure()
# ax = fig.add_subplot(111, projection = '3d')
# colormap = plt.cm.coolwarm 
# norm_angle = plt.Normalize(0, theta_spread)

# for sol, angle_theta in trajectories[::3]:
#     color = colormap(norm_angle(angle_theta))
#     ax.plot(sol.y[0], sol.y[1], sol.y[2], color = color, linewidth = 0.5)

# Y, Z = np.meshgrid([-screen_half_side_length, screen_half_side_length],
#                    [-screen_half_side_length, screen_half_side_length])
# X = np.full_like(Y, x_screen)
# ax.plot_surface(X, Y, Z, alpha=0.2, color='lightgray')

# ax.set_xlim (source_position[0] - 1, x_screen + 1)
# ax.set_ylim (-plot_half_side, plot_half_side)
# ax.set_zlim (-plot_half_side, plot_half_side)
# ax.set_title("Trajectory Map")

# plt.show()

# #Gradient Plotting
# fig = plt.figure()
# ax = fig.add_subplot(projection='polar')
# for item in gradient_map:
#     if np.floor(2*item[0]) % 2 == np.floor(2*item[1]) % 2:
#         color = 'blue'
#     else:
#         color = 'red'
#     scatter = ax.scatter(item[3], 5*np.sin(item[2]), color = color, alpha = 0.75, s = 10)
# plt.title("Gradient Map")

# plt.show()
