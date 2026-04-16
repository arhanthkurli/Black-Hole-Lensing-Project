# %%
import numpy as np
from scipy.integrate import solve_ivp
import plotly.graph_objects as go


# %%

def star_planet_moon(t, state, M_star, M_planet, G):
    x1, y1, z1, vx1, vy1, vz1, x2, y2, z2, vx2, vy2, vz2 = state # 1 represents planet, 2 represents moon
    r1 = np.sqrt(x1**2 + y1**2 + z1**2) # Distance from star to planet
    r2 = np.sqrt((x2-x1)**2 + (y2-y1)**2 + (z2-z1)**2) # Distance from planet to moon
    r3 = np.sqrt(x2**2 + y2**2 + z2**2) # Distance from star to moon
    dx1dt = vx1
    dy1dt = vy1
    dz1dt = vz1
    dvx1dt = -G * M_star * x1 / r1**3
    dvy1dt = -G * M_star * y1 / r1**3
    dvz1dt = -G * M_star * z1 / r1**3
    dx2dt = vx2
    dy2dt = vy2
    dz2dt = vz2
    dvx2dt = -G * (M_planet * (x2 - x1) / r2**3 + M_star * x2 / r3**3)
    dvy2dt = -G * (M_planet * (y2 - y1) / r2**3 + M_star * y2 / r3**3)
    dvz2dt = -G * (M_planet * (z2 - z1) / r2**3 + M_star * z2 / r3**3)
    return [dx1dt, dy1dt, dz1dt, dvx1dt, dvy1dt, dvz1dt, dx2dt, dy2dt, dz2dt, dvx2dt, dvy2dt, dvz2dt]


# All units in AU/years/solar masses
# Set to replicate the Sun-Earth-Moon system, acconting for Moon's deviation from Earth's orbital plane
G = 4 * np.pi**2

M_star = 1.0
M_planet = 3 * 10**-6
r_moon = 0.00257
v_moon = np.sqrt(G * M_planet / r_moon)
theta = np.radians(5.1)

x1, y1, z1 = 1, 0, 0
vx1, vy1, vz1 = 0, 2*np.pi, 0

x2, y2, z2 = x1 + r_moon * np.cos(theta), y1, z1 + r_moon * np.sin(theta)
vx2, vy2, vz2 = vx1, vy1+ v_moon, vz1

t_start, t_end = 0, 4

state0 = [x1, y1, z1, vx1, vy1, vz1, x2, y2, z2, vx2, vy2, vz2]

sol = solve_ivp(star_planet_moon, (0, 4), state0, args = (M_star, M_planet, G), max_step = 0.001)

x_planet = sol.y[0]
y_planet = sol.y[1]
z_planet = sol.y[2]

x_moon = sol.y[6]
y_moon = sol.y[7]
z_moon = sol.y[8]


# The interactive Plotly animation is defined in the next cell.



# %%
# Animated interactive view of the simulated system.
frame_stride = max(len(sol.t) // 200, 1)
frame_indices = np.arange(0, len(sol.t), frame_stride, dtype=int)
if frame_indices[-1] != len(sol.t) - 1:
    frame_indices = np.append(frame_indices, len(sol.t) - 1)


initial_idx = int(frame_indices[0])

animated_fig = go.Figure(
    data=[
        go.Scatter3d(
            x=x_planet[: initial_idx + 1],
            y=y_planet[: initial_idx + 1],
            z=z_planet[: initial_idx + 1],
            mode='lines',
            name='Earth path',
            line=dict(color='royalblue', width=5)
        ),
        go.Scatter3d(
            x=x_moon[: initial_idx + 1],
            y=y_moon[: initial_idx + 1],
            z=z_moon[: initial_idx + 1],
            mode='lines',
            name='Moon path',
            line=dict(color='dimgray', width=4)
        ),
        go.Scatter3d(
            x=[x_planet[initial_idx]],
            y=[y_planet[initial_idx]],
            z=[z_planet[initial_idx]],
            mode='markers',
            name='Earth',
            marker=dict(color='royalblue', size=6)
        ),
        go.Scatter3d(
            x=[x_moon[initial_idx]],
            y=[y_moon[initial_idx]],
            z=[z_moon[initial_idx]],
            mode='markers',
            name='Moon',
            marker=dict(color='lightgray', size=4)
        ),
        go.Scatter3d(
            x=[0],
            y=[0],
            z=[0],
            mode='markers',
            name='Sun',
            marker=dict(color='gold', size=10)
        )
    ],
    frames=[
        go.Frame(
            data=[
                go.Scatter3d(
                    x=x_planet[: idx + 1],
                    y=y_planet[: idx + 1],
                    z=z_planet[: idx + 1]
                ),
                go.Scatter3d(
                    x=x_moon[: idx + 1],
                    y=y_moon[: idx + 1],
                    z=z_moon[: idx + 1]
                ),
                go.Scatter3d(
                    x=[x_planet[idx]],
                    y=[y_planet[idx]],
                    z=[z_planet[idx]]
                ),
                go.Scatter3d(
                    x=[x_moon[idx]],
                    y=[y_moon[idx]],
                    z=[z_moon[idx]]
                )
            ],
            traces=[0, 1, 2, 3],
            name=f'{sol.t[idx]:.2f}'
        )
        for idx in frame_indices
    ]
)

slider_steps = [
    dict(
        method='animate',
        args=[
            [f'{sol.t[idx]:.2f}'],
            dict(
                mode='immediate',
                frame=dict(duration=0, redraw=True),
                transition=dict(duration=0)
            )
        ],
        label=f'{sol.t[idx]:.2f}'
    )
    for idx in frame_indices
]

animated_fig.update_layout(
    title='Interactive Sun-Earth-Moon Orbit',
    scene=dict(
        xaxis=dict(title='x', range=[-1.5, 1.5]),
        yaxis=dict(title='y', range=[-1.5, 1.5]),
        zaxis=dict(title='z', range=[-1.5, 1.5]),
        aspectmode='cube'
    ),
    margin=dict(l=0, r=0, t=50, b=0),
    uirevision='orbit',
    updatemenus=[
        dict(
            type='buttons',
            showactive=False,
            x=0.02,
            y=1.05,
            buttons=[
                dict(
                    label='Play',
                    method='animate',
                    args=[
                        None,
                        dict(
                            frame=dict(duration=60, redraw=True),
                            transition=dict(duration=0),
                            fromcurrent=True
                        )
                    ]
                ),
                dict(
                    label='Pause',
                    method='animate',
                    args=[[None], dict(mode='immediate', frame=dict(duration=0, redraw=False), transition=dict(duration=0))]
                )
            ]
        )
    ],
    sliders=[
        dict(
            active=0,
            currentvalue=dict(prefix='Time (years): '),
            pad=dict(t=50),
            steps=slider_steps
        )
    ]
)

animated_fig.show()


# %%



