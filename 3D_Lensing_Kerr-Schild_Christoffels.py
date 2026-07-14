#%%
import numpy as np
from scipy.integrate import solve_ivp
from scipy.spatial.transform import Rotation
import sympy as sp
import matplotlib.pyplot as plt
import json
from time import time

#Adjustable Constants
G, M, a = 1.0, 0.5, 0.25
# Set the spin to 0 for testing
G, M, a = 1.0, 0.5, 0.0

t, x, y, z = sp.symbols('t x y z')

R2 = x**2 + y**2 + z**2
r = sp.sqrt((R2 - a**2 + sp.sqrt((R2 - a**2)**2 + 4 * a**2 * z**2))/2)

eta = sp.diag(-1, 1, 1, 1)
f = 2 * G * M * r**3/(r**4 + a**2 * z**2)

k_x = (r*x + a*y)/(r**2 + a**2)
k_y = (r*y - a*x)/(r**2 + a**2)
k_z = z/r

k = sp.Matrix([1, k_x, k_y, k_z])
l = sp.Matrix([-1, k_x, k_y, k_z])

g = eta + f * k * k.T

g_inv = eta - f * l * l.T

print('g and g_inv calculated')
#%%
#Computing christoffels

coords = [t, x, y, z]
derivatives = [[[0 for _ in range(4)] for _ in range(4)] for _ in range(4)]

for i in range(4):
    # g[i, j] = g[j, i], so differentiate only the upper triangle.
    for j in range(i, 4):
        for d in range(4):
            start_time = time()
            derivative = sp.simplify(sp.diff(g[i, j], coords[d]))
            derivatives[i][j][d] = derivative
            derivatives[j][i][d] = derivative
            print(f"{i},{j},{d}: {time()-start_time}")
#%%
print('Derivative list created')

def compute_christoffel():
    out = [[[0 for _ in range(4)] for _ in range (4)] for _ in range(4)]
    half = sp.Rational(1, 2)
    for mu in range(4):
        for alpha in range(4):
            # The Levi-Civita connection is symmetric in its lower indices.
            for beta in range(alpha, 4):
                total = 0
                for lmbda in range(4):
                    total += half * g_inv[mu, lmbda] * (
                        derivatives[lmbda][beta][alpha]
                        + derivatives[lmbda][alpha][beta]
                        - derivatives[alpha][beta][lmbda]
                    )
                start_time = time()
                christoffel = sp.simplify(total)
                out[mu][alpha][beta] = christoffel
                out[mu][beta][alpha] = christoffel
                print(f"{mu},{alpha},{beta}: {time()-start_time}")
    return out

result = compute_christoffel()

print('Christoffels computed')
#%%
nonzero_index, nonzero_value = [], []
for mu in range(4):
    for alpha in range(4):
        # Keep only independent lower-index pairs.  Off-diagonal terms get a
        # factor of two in the geodesic contraction below.
        for beta in range(alpha, 4):
            if result[mu][alpha][beta] != 0:
                nonzero_index.append((mu, alpha, beta))
                nonzero_value.append(result[mu][alpha][beta])

christoffel_dict = {'index': nonzero_index, 'value': [sp.srepr(item) for item in nonzero_value]}
with open('christoffels.json', 'w') as file:
    json.dump(christoffel_dict, file)



