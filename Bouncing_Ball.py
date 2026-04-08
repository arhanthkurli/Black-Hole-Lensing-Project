import numpy as np
from scipy.integrate import solve_ivp
import matplotlib.pyplot as plt

# Uses ODE to model bouncing ball
def ball(t, state):
    y, v = state
    dydt = v
    dvdt = -9.81
    return [dydt, dvdt]

#Determines when ball hits the ground; used to stop solve_ivp and reset conditions for next bounce
def hit_ground(t, state):
    return state[0]  

hit_ground.terminal = True 

y0 = 10 # Initial height
v0 = 0 # Initial downward velocity
state0 = [y0, v0]
t_start = 0 # Start time
t_end = 100 # End time (long enough to see multiple bounces)

t_list = []
y_list = []

bounces = 0

# Choose number of bounces and maximum step size in seconds (smaller step size for more accurate results)
while bounces < 5: 
    sol = solve_ivp(ball, (t_start, t_end), state0, events=hit_ground, max_step=.01)
    t_list.append(sol.t)
    y_list.append(sol.y[0])
# Condition reset after ball hits ground; velocity is reversed, and can be slightly reduced ot simulate energy loss on bounce
    v_new = -sol.y[1][-1] * 0.8  # Coefficient simulates energy loss 
    state0 = [.00001, v_new]
    t_start = sol.t[-1]
    bounces += 1



t_list = np.concatenate(t_list) # contains all time points
y_list = np.concatenate(y_list) # contains all height points

plt.plot(t_list, y_list)
plt.xlabel('Time')
plt.ylabel('Height')
plt.title('Bouncing Ball')
plt.show()