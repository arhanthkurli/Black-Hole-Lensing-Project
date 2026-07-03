import numpy as np
from scipy.integrate import solve_ivp
from scipy.spatial.transform import Rotation
import sympy as sp
import matplotlib.pyplot as plt

#Positional Parameters
source_position = (-50.0, 0.0, 0.0)
x_screen = 30.0

#Adjustable Constants
G, c, M, a = 1.0, 1.0, 0.5, 0.25

r_plus = M + np.sqrt(M**2 - a**2)
r_cut = 1.10 * r_plus

t_sym, x_sym, y_sym, z_sym = sp.symbols('t x y z')
r = sp.Function('r')(x_sym, y_sym, z_sym)

eta = sp.diag(-1, 1, 1, 1)
f = 2 * G * M * r**3/(r**4 + a**2 * z_sym**2)

k_x = (r*x_sym + a*y_sym)/(r**2 + a**2)
k_y = (r*y_sym - a*x_sym)/(r**2 + a**2)
k_z = z_sym/r

k = sp.Matrix([1, k_x, k_y, k_z])

g = eta + f * k * k.T

g_inv = g.inv()

r_plain = sp.symbols('r')

R2 = x_sym**2 + y_sym**2 + z_sym**2
F = r_plain**4 - (R2 - a**2) * r_plain**2 - a**2 * z_sym**2

dr_dx = -F.diff(x_sym)/F.diff(r_plain)
dr_dy = -F.diff(y_sym)/F.diff(r_plain)
dr_dz = -F.diff(z_sym)/F.diff(r_plain)

dr_dx = dr_dx.subs(r_plain, r)
dr_dy = dr_dy.subs(r_plain, r)
dr_dz = dr_dz.subs(r_plain, r)

repl = {
    sp.Derivative(r, x_sym): dr_dx,
    sp.Derivative(r, y_sym): dr_dy,
    sp.Derivative(r, z_sym): dr_dz,
}

#Computing christoffels
def compute_christoffel():
    coords = [t_sym, x_sym, y_sym, z_sym]
    out = [[[0 for _ in range(4)] for _ in range (4)] for _ in range(4)]
    for mu in range(4):
        for alpha in range(4):
            for beta in range(4):
                total = 0
                for lmbda in range(4):
                    total += 0.5 *g_inv[mu, lmbda] * (sp.diff(g[lmbda, beta], coords[alpha]) + 
                                                            sp.diff(g[lmbda, alpha], coords[beta]) - 
                                                            sp.diff(g[alpha, beta], coords[lmbda]))
                out[mu][alpha][beta] = sp.simplify(total.subs(repl))
    return out

result = compute_christoffel()

nonzero_index, nonzero_value = [], []
for mu in range(4):
    for alpha in range(4):
        for beta in range (4):
            if result[mu][alpha][beta] != 0:
                nonzero_index.append((mu, alpha, beta))
                nonzero_value.append(result[mu][alpha][beta])

Gamma = sp.lambdify([x_sym, y_sym, z_sym], nonzero_value, 'numpy')

def trajectory(tau, state):
    x, y, z = state[1], state[2], state[3]
    u = state[4:8]
    du = [0.0 for _ in range(4)]
    Gamma_result = Gamma(x, y, z)
    for (mu, a, b), value in zip(nonzero_index, Gamma_result):
        du[mu] -= value * u[a] * u[b]
    return np.concatenate((u, du))

