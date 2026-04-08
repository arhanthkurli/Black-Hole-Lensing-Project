import numpy as np
from scipy.integrate import solve_ivp
import matplotlib.pyplot as plt

# Uses ODE to model Newtonian orbit 
def newtonian_orbit(t, state, GM):
    x, y, z, vx, vy, vz = state
    r = np.sqrt(x**2 + y**2 + z**2)
    dxdt = vx
    dydt = vy
    dzdt = vz
    dvxdt = -GM * x / r**3
    dvydt = -GM * y / r**3
    dvzdt = -GM * z / r**3
    return [dxdt, dydt, dzdt, dvxdt, dvydt, dvzdt]

# Uses ODE to model relativistic orbit 
def relativistic_orbit(t, state, GM, c):
    x, y, z, vx, vy, vz = state
    h = x * vy - y * vx  
    r = np.sqrt(x**2 + y**2 + z**2)
    dxdt = vx
    dydt = vy
    dzdt = vz
    dvxdt = -GM * x / r**3 * (1 + 3 * h**2 / (r**2 * c**2))
    dvydt = -GM * y / r**3 * (1 + 3 * h**2 / (r**2 * c**2))
    dvzdt = -GM * z / r**3 * (1 + 3 * h**2 / (r**2 * c**2))
    return [dxdt, dydt, dzdt, dvxdt, dvydt, dvzdt]

#ALL UNITS IN AU OR DAYS FOR REAL SYSTEMS, BUT CAN BE ADJUSTED FOR PRACTICALITY 
GM = 1.0  # Gravitational constant times mass of central body (adjustable)
c = 2  # Speed of light (adjustable for practicality)
x0 = 3.0   # Initial x position  
y0 = 0.0   # Initial y position
z0 = 0.0   # Initial z position
vx0 = 0.0    # Initial x velocity
vy0 = np.sqrt(GM / x0) * 1.1 # Initial y velocity; set for circular orbit, but coefficient can be adjusted for elliptical orbits (or reaching escape velocity)
vz0 = 0.25    # Initial z velocity

state0 = [x0, y0, z0, vx0, vy0, vz0]
t_start = 0 # Start time
t_end = 200 # End time 

#Choose type of orbit (newtonian or reletavistic) and maximum step size in seconds (smaller step size for more accurate results)
sol = solve_ivp( relativistic_orbit, (t_start, t_end), state0, args= (GM, c), max_step = 0.1)
x = sol.y[0] # x position over time
y = sol.y[1] # y position over time
z = sol.y[2] # z position over time


fig = plt.figure()
ax = fig.add_subplot(111, projection='3d')

ax.plot(x, y, z)
ax.scatter(0, 0, 0, color='yellow', s=200)  # Central body

ax.set_xlabel('x')
ax.set_ylabel('y')
ax.set_zlabel('z')
ax.set_title('Orbit')
plt.show()


