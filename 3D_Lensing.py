import numpy as np
from scipy.integrate import solve_ivp
import matplotlib.pyplot as plt

x_source = -10
x_lens = -5
screen_x = 0
screen_half_side_length = 200
theta_spread = np.radians(30)
N = 20

G = 1.0
M_lens = 0.3
GM = G * M_lens
R_lens = 0.3
v = 1.0

def trajectory(t, state, GM):
    x, y, z, vx, vy, vz = state
    r = np.sqrt((x - x_lens)**2 + y**2 + z**2)
    dxdt = vx
    dydt = vy
    dzdt = vz
    dvxdt = -GM * (x - x_lens) / r**3
    dvydt = -GM * y / r**3
    dvzdt = -GM * z / r**3
    return [dxdt, dydt, dzdt, dvxdt, dvydt, dvzdt]

def hit_screen(t, state, GM):
    return state[0] - screen_x

hit_screen.terminal = True

def hit_object(t, state, GM):
    return np.sqrt((state[0] - x_lens)**2 + state[1]**2 + state[2]**2) - R_lens

hit_object.terminal = True

theta = np.concatenate([np.linspace(-theta_spread, -np.arctan(R_lens/(x_lens-x_source)), N), 
                        np.linspace(np.arctan(R_lens/(x_lens-x_source)), theta_spread, N)])

trajectories = []
hits = []

for angle_theta in theta:
    for angle_phi in np.linspace(0, 2 * np.pi, 100):
        vx0 = v * np.cos(angle_theta)
        vy0 = v * np.cos(angle_phi) * np.sin(angle_theta)
        vz0 = v * np.sin(angle_phi) * np.sin(angle_theta)
        state0 = [x_source, 0, 0, vx0, vy0, vz0] 

        sol = solve_ivp(trajectory, (0,100), state0, args = (GM,), 
                        events = [hit_screen, hit_object], atol = 1e-8, rtol = 1e-8)
        
        trajectories.append((sol, angle_theta))

#Plotting
fig = plt.figure()
ax = fig.add_subplot(111, projection = '3d')
colormap = plt.cm.coolwarm 
norm_angle = plt.Normalize(0, theta_spread)

for sol, angle_theta in trajectories[::3]:
    color = colormap(norm_angle(abs(angle_theta)))
    ax.plot(sol.y[0], sol.y[1], sol.y[2], color = color, linewidth = 0.5)

Y, Z = np.meshgrid([-screen_half_side_length, screen_half_side_length],
                   [-screen_half_side_length, screen_half_side_length])
X = np.full_like(Y, screen_x)
ax.plot_surface(X, Y, Z, alpha=0.3, color='lightgray')

ax.set_xlim (-11, 1)
ax.set_ylim (-10, 10)
ax.set_zlim (-10, 10)

ax.set_title("Trajectories")
plt.show()

