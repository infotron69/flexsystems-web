import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

function resultColor(row) {
  if (row.missed_point === 'Y') return '#f97316'; // orange — missed, not a genuine inspection
  if (row.inspection_result === 'Y') return '#16a34a'; // green
  if (row.inspection_result === 'N') return '#dc2626'; // red
  return '#9ca3af';                     // gray — no result recorded
}

function dotIcon(color) {
  return L.divIcon({
    className: 'gps-dot-icon',
    html: `<div style="width:16px;height:16px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 3px rgba(0,0,0,0.6);"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    popupAnchor: [0, -8],
  });
}

// Renders a Leaflet map of GPS-tagged transaction rows (each needs gps_lat,
// gps_lng, point_desc, guard, trans_date, trans_time, inspection_result).
// Shared by the Dashboard's mini map and the full GPS Map report.
export default function GpsMapView({ rows, height = 400 }) {
  const mapDivRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);

  useEffect(() => {
    if (!mapDivRef.current || mapRef.current) return;
    const map = L.map(mapDivRef.current);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);
    map.setView([39.5, -98.35], 4); // continental US fallback until rows arrive
    mapRef.current = map;
    layerRef.current = L.layerGroup().addTo(map);
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();

    const validRows = rows.filter(r => Number.isFinite(r.gps_lat) && Number.isFinite(r.gps_lng));
    if (validRows.length === 0) return;

    const markers = validRows.map(r => {
      const when = [r.trans_date?.slice(0, 10), r.trans_time?.slice(11, 16)].filter(Boolean).join(' ');
      const resultLabel = r.missed_point === 'Y' ? 'Missed'
        : r.inspection_result === 'Y' ? 'Pass'
        : r.inspection_result === 'N' ? 'Fail'
        : 'No result';
      const m = L.marker([r.gps_lat, r.gps_lng], { icon: dotIcon(resultColor(r)) });
      m.bindPopup(
        `<strong>${r.point_desc || 'Unknown point'}</strong><br/>` +
        `Operator: ${r.guard || '—'}<br/>` +
        `${when}<br/>` +
        `Result: ${resultLabel}`
      );
      m.addTo(layer);
      return m;
    });

    if (markers.length === 1) {
      map.setView(markers[0].getLatLng(), 16);
    } else {
      map.fitBounds(L.featureGroup(markers).getBounds().pad(0.2));
    }
  }, [rows]);

  return <div ref={mapDivRef} style={{ height, borderRadius: 6, overflow: 'hidden' }} />;
}
