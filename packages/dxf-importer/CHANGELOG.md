# @pascal-app/dxf-importer changelog

## 0.1.0 — initial release (issue #158)
- DXF (ASCII) parser via dxf-parser
- Multilingual layer-name classifier (AIA + EN + DE + FR + ES + IT + JP SXF + Chinese + Allplan + curtain wall taxonomy)
- $INSUNITS table + $MEASUREMENT fallback (FreeCAD's heuristic) + bbox heuristic
- LWPOLYLINE bulge / ARC / CIRCLE chord tessellation
- DWG file detection (`detectFileFormat`, `assertNotDwg`, `UnsupportedDwgError`)
- Coordinate transform (DXF Z-up -> editor Y-up XZ-plane), recenter to origin
- 5+ hand-crafted DXF test fixtures, full Vitest coverage
- Default wall height 2.5 m, thickness 0.1 m (matches Pascal native defaults)
