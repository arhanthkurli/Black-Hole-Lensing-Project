import numpy as np
from scipy.integrate import solve_ivp
import matplotlib.pyplot as plt

x_source = -10
x_lens = -5
screen_x = 0
screen_half_width = 100
angle_spread = np.radians(60)
N = 1000

G = 1.0
M_lens = 0.3
GM = G * M_lens
R_lens = 0.1
v = 1.0

def trajectory(t, state, GM):
    x, y, vx, vy = state
    r = np.sqrt((x - x_lens)**2 + y**2)
    dxdt = vx
    dydt = vy
    dvxdt = -GM * (x - x_lens) / r**3
    dvydt = -GM * y / r**3
    return [dxdt, dydt, dvxdt, dvydt]

def hit_screen(t, state, GM):
    return state[0] - screen_x

hit_screen.terminal = True

def hit_object(t, state, GM):
    return np.sqrt((state[0] - x_lens)**2 + state[1]**2) - R_lens

hit_object.terminal = True

angles = np.concatenate([-np.logspace(np.log10(np.arctan(R_lens/(x_lens-x_source))), np.log10(angle_spread), N), np.logspace(np.log10(np.arctan(R_lens/(x_lens-x_source))), np.log10(angle_spread), N)])

hits = {}
absorbed = 0
trajectories = []

for angle in angles:
    vx0 = v * np.cos(angle)
    vy0 = v * np.sin(angle)
    state0 = [x_source, 0, vx0, vy0]

    sol = solve_ivp(trajectory, (0, 100), state0, args=(GM,),
                    events=[hit_screen, hit_object], atol=1e-8, rtol=1e-8)

    trajectories.append(sol)

    if len(sol.t_events[0]) > 0:
        y_hit = sol.y_events[0][0][1]
        if -screen_half_width <= y_hit <= screen_half_width:
            if y_hit > 0:
                hits[angle] = 1
            else:
                hits[angle] = 0
    elif len(sol.t_events[1]) > 0:
        absorbed += 1


#print(f"hits: {len(hits)}, absorbed: {absorbed}, missed: {N - len(hits) - absorbed}")

# Plot distribution
# bins = 100
# counts, bin_edges = np.histogram(hits, bins=bins, range=(-screen_half_width, screen_half_width))
# counts_2d = counts.reshape(1, -1)

# plt.figure(figsize=(10, 3))
# plt.imshow(counts_2d, extent=[-screen_half_width, screen_half_width, 0, 1],
#            cmap='hot', norm=LogNorm(), aspect='auto')
# plt.colorbar(label='hit count')
# plt.xlabel('y position on screen')
# plt.title('Gravitational Lensing Distribution')
# plt.show()

# Plot trajectories
# plt.figure()
# norm = plt.Normalize(-angle_spread, angle_spread)
# colormap = plt.cm.coolwarm
# for i,sol in enumerate(trajectories[::20]):
#     color = colormap(norm(angles[i * 20]))
#     plt.plot(sol.y[0], sol.y[1], color = color, linewidth = 0.5)

# plt.axvline(x=screen_x, color='white', label='screen')
# plt.axvline(x=x_lens, color='yellow', label='lens')
# plt.xlim(-15, 5)
# plt.ylim(-20, 20)
# plt.grid()
# plt.legend()
# plt.title('Trajectories')
# plt.show()