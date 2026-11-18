# Kerr Black Hole Lensing

Interactive gravitational lensing around a spinning (Kerr) black hole, rendered in the browser.

**[▶ Live demo](https://arhanthkurli.github.io/Black-Hole-Lensing-Project/)** · **[📄 Full report](https://github.com/arhanthkurli/Black-Hole-Lensing-Project/blob/master/Black_Hole_Simulation_Report.pdf)**

![Lensed background around a Kerr black hole](lensed-image.png)

Null geodesics are integrated offline in Python (SymPy, SciPy) using Kerr-Schild coordinates, then baked into a precomputed warp map. A WebGL shader reads that map to distort the background image in real time. 

The site was built with the help of an AI model, but all web simulations and plots are based on my computations.

The full report covers the physics, the development phases, and the design decisions behind the pipeline.
