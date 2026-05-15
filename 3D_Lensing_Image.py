import numpy as np
from scipy.integrate import solve_ivp
from scipy.spatial.transform import Rotation
import matplotlib.pyplot as plt

source_position = (-10, -2, 0)
x_lens = 0
x_screen = 2
screen_half_side_length = 5
theta_spread = np.radians(15)
plot_half_side = 3
N = 50

G = 2
M_lens = 0.3
GM = G * M_lens
R_lens = 0.07
v = 1.0

def trajectory(t, state, GM):
    x, y, z, vx, vy, vz = state
    r = np.sqrt(x**2 + y**2 + z**2)
    dxdt = vx
    dydt = vy
    dzdt = vz
    dvxdt = -GM * x / r**3
    dvydt = -GM * y / r**3
    dvzdt = -GM * z / r**3
    return [dxdt, dydt, dzdt, dvxdt, dvydt, dvzdt]

def hit_screen(t, state, GM):
    return state[0] - x_screen

hit_screen.terminal = True

def hit_object(t, state, GM):
    return np.sqrt(state[0]**2 + state[1]**2 + state[2]**2) - R_lens

hit_object.terminal = True

#theta = np.linspace(np.arctan(R_lens/np.linalg.norm(source_position)), theta_spread, N)
theta = np.linspace(theta_spread, np.arctan(R_lens/np.linalg.norm(source_position)), N)

Rot, _ = Rotation.align_vectors([ - np.array(source_position) / np.linalg.norm(source_position)], [[1, 0, 0]])

trajectories = []
hits = []
gradient_map = []
absorbed = []

for angle_theta in theta:
    for angle_phi in np.linspace(0, 2 * np.pi, 100):
        vx0 = v * np.cos(angle_theta)
        vy0 = v * np.cos(angle_phi) * np.sin(angle_theta)
        vz0 = v * np.sin(angle_phi) * np.sin(angle_theta)
        
        v_final = Rot.apply([vx0, vy0, vz0])
        state0 = [source_position[0], source_position[1], source_position[2], v_final[0], v_final[1], v_final[2]] 

        sol = solve_ivp(trajectory, (0,100), state0, args = (GM,), 
                        events = [hit_screen, hit_object], atol = 1e-6, rtol = 1e-6)
        if len(sol.t_events[1]) == 0:
            trajectories.append((sol, angle_theta))

        if len(sol.t_events[0]) > 0 and len(sol.t_events[1]) == 0:
            y_hit = sol.y_events[0][0][1]
            z_hit = sol.y_events[0][0][2]
            gradient_map.append((y_hit, z_hit, angle_theta, angle_phi))
    
    if len(sol.t_events[1]) > 0:
        absorbed.append((sol, angle_theta))
    

# Trajectory Plotting
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

#Gradient Plotting
fig = plt.figure()
ax = fig.add_subplot(projection='polar')
for item in gradient_map:
    if np.floor(item[0]) % 2 == np.floor(item[1]) % 2:
        color = 'blue'
    else:
        color = 'red'
    scatter = ax.scatter(item[3], 5*np.sin(item[2]), color = color, alpha = 0.75, s = 10)
plt.title("Gradient Map")
plt.show()
