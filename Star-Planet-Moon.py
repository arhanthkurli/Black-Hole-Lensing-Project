import numpy as np
from scipy.integrate import solve_ivp
import matplotlib.pyplot as plt

# Use ODE to plot three body planetary systems
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
r_moon = 0.00257 # Moon to planet distance
v_moon = np.sqrt(G * M_planet / r_moon) # Orbital speed of moon
theta = np.radians(5.1) # Tilt of moon's orbit (relative to planets orbital plane)

# DO NOT ADJUST following initial conditions
x1, y1, z1 = 1, 0, 0 # Initial planet posiiton 
vx1, vy1, vz1 = 0, 2*np.pi, 0 # Initial Planet Velocity 

x2, y2, z2 = x1 + r_moon * np.cos(theta), y1, z1 + r_moon * np.sin(theta) # Initial moon position
vx2, vy2, vz2 = vx1, vy1+ v_moon, vz1 #Initial moon velocity

t_start, t_end = 0, 4 # Time span (years)

state0 = [x1, y1, z1, vx1, vy1, vz1, x2, y2, z2, vx2, vy2, vz2]

sol = solve_ivp(star_planet_moon, (0, 4), state0, args = (M_star, M_planet, G), max_step = 0.001)

# Planet orbit
x_planet = sol.y[0]
y_planet = sol.y[1]
z_planet = sol.y[2]

#Moon path
x_moon = sol.y[6]
y_moon = sol.y[7]
z_moon = sol.y[8]


fig = plt.figure()
ax = fig.add_subplot(111, projection='3d')

ax.plot(x_planet, y_planet, z_planet, label='Earth', color='blue')
ax.plot(x_moon, y_moon, z_moon, label='Moon', color='gray')
ax.scatter(0, 0, 0, color='yellow', s=200, label='Sun')
ax.legend()

# Prevents unwanted elliptical lunar orbits
ax.set_xlim(-1.5, 1.5)
ax.set_ylim(-1.5, 1.5)
ax.set_zlim(-1.5, 1.5)

ax.set_xlabel('x')
ax.set_ylabel('y')
ax.set_zlabel('z')
ax.set_title('Orbit')
plt.show()
