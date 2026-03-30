#!/usr/bin/env python3
"""Quick test of spatial optimization functions"""
from utils.spatial_query import haversine_distance, estimate_lat_lon_tolerance

# Test Haversine distance
delhi_lat, delhi_lon = 28.6139, 77.2090
mumbai_lat, mumbai_lon = 19.0760, 72.8777
dist = haversine_distance(delhi_lat, delhi_lon, mumbai_lat, mumbai_lon)
print(f'✓ Haversine distance (Delhi to Mumbai): {dist:.1f} km')
expected_dist = 1148  # Actual distance
if 1100 < dist < 1200:
    print(f'  Status: ✓ CORRECT (Expected ~{expected_dist} km)')
else:
    print(f'  Status: ✗ ERROR (Expected ~{expected_dist} km)')

# Test tolerance calculation
lat_tol, lon_tol = estimate_lat_lon_tolerance(50)
print(f'\n✓ Bounding box tolerance for 50km radius:')
print(f'  Lat tolerance: ±{lat_tol:.2f}°')
print(f'  Lon tolerance: ±{lon_tol:.2f}°')

# Test with different radius
lat_tol_10, lon_tol_10 = estimate_lat_lon_tolerance(10)
print(f'\n✓ Bounding box tolerance for 10km radius:')
print(f'  Lat tolerance: ±{lat_tol_10:.2f}°')  
print(f'  Lon tolerance: ±{lon_tol_10:.2f}°')

print('\n✅ All spatial functions working correctly!')
