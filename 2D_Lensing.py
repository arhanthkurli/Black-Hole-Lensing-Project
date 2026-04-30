import numpy as np
from scipy.integrate import solve_ivp
import matplotlib.pyplot as plt

x_source = -10
x_lens = -5
screen_x = 0
screen_half_width = 100
angle_spread = np.radians(30)
N = 1000

G = 1.0
M_lens = 0.3
GM = G * M_lens
R_lens = 0.3
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

angles = np.concatenate([np.linspace(-angle_spread, -np.arctan(R_lens/(x_lens-x_source)), N), 
                         np.linspace(np.arctan(R_lens/(x_lens-x_source)), angle_spread, N)])

hits = []
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
                hits.append([angle, 1])
            else:
                hits.append([angle, 0])
    elif len(sol.t_events[1]) > 0:
        absorbed += 1

hit_ranges = []
start_hit = hits[0][1]
for hit in hits:
    if start_hit != hit[1]:
        hit_ranges.append(hit[0])
        start_hit = hit[1]

print(hit_ranges)

#Plot trajectories
plt.figure()
norm = plt.Normalize(-angle_spread, angle_spread)
colormap = plt.cm.coolwarm
for i,sol in enumerate(trajectories[::50]):
    color = colormap(norm(angles[i * 50]))
    plt.plot(sol.y[0], sol.y[1], color = color, linewidth = 0.5)

plt.axvline(x=screen_x, color='white', label='screen')
plt.axvline(x=x_lens, color='yellow', label='lens')
plt.xlim(-15, 5)
plt.ylim(-20, 20)
plt.grid()
plt.legend()
plt.title('Trajectories')
plt.show()

fig, ax = plt.subplots()
ax.axvspan(-angle_spread, hit_ranges[0], color='blue', alpha=0.5)
ax.axvspan(hit_ranges[0], hit_ranges[1], color='red', alpha=0.5)
ax.axvspan(hit_ranges[1], hit_ranges[2], color='blue', alpha=0.5)
ax.axvspan(hit_ranges[2], angle_spread, color='red', alpha=0.5)

for point in hit_ranges:
    ax.axvline(x=point, color='black', linewidth=0.5)

ax.yaxis.set_visible(False)
ax.set_ylim(0, 1)
ax.set_xlim(-angle_spread, angle_spread)
ax.set_xlabel('launch angle (radians)')
ax.set_title('Screen hit regions')
plt.show()

