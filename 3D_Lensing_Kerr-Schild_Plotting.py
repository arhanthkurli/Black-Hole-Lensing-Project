import json
import matplotlib.pyplot as plt

with open('Kerr-schild.json') as file:
    hit_points = json.load(file)

fig, ax = plt.subplots(figsize=(8, 6))
for y, z, i_theta, i_phi in hit_points:
    ax.plot(y, z, 'o', ms=4, color='red' if i_phi == 0 else 'green')

ax.set_aspect('equal')
ax.set_xlabel('y')
ax.set_ylabel('z')
ax.set_title('Screen hits at x = 30')
ax.grid(alpha=0.3)
plt.show()