import React, { useMemo, useRef } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';

interface LeafletMapProps {
  latitude: number;
  longitude: number;
  zoom?: number;
  interactive?: boolean;
  style?: StyleProp<ViewStyle>;
  onPick?: (coords: { latitude: number; longitude: number }) => void;
}

// Renders OpenStreetMap tiles via Leaflet inside a WebView — no native map SDK
// (and no Google/Apple Maps API key) is required on either platform this way.
function buildHtml({ latitude, longitude, zoom, interactive }: Required<Pick<LeafletMapProps, 'latitude' | 'longitude' | 'zoom' | 'interactive'>>) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <style>
    html, body, #map { height: 100%; margin: 0; padding: 0; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    const map = L.map('map', {
      zoomControl: ${interactive},
      dragging: ${interactive},
      scrollWheelZoom: ${interactive},
      doubleClickZoom: ${interactive},
      touchZoom: ${interactive},
      boxZoom: false,
      keyboard: false,
      attributionControl: true,
    }).setView([${latitude}, ${longitude}], ${zoom});

    // CARTO Voyager — OSM data rendered with a light, colorful style (green parks,
    // blue water, white/yellow roads) similar to Google Maps, unlike the more
    // muted default OSM tile style.
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      subdomains: 'abcd',
      detectRetina: true,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    }).addTo(map);

    let marker = L.marker([${latitude}, ${longitude}]).addTo(map);

    if (${interactive}) {
      map.on('click', (e) => {
        marker.setLatLng(e.latlng);
        window.ReactNativeWebView.postMessage(JSON.stringify({
          latitude: e.latlng.lat,
          longitude: e.latlng.lng,
        }));
      });
    }

    window.setMarker = function(lat, lng) {
      marker.setLatLng([lat, lng]);
      map.setView([lat, lng], map.getZoom());
    };
  </script>
</body>
</html>`;
}

export function LeafletMap({ latitude, longitude, zoom = 15, interactive = false, style, onPick }: LeafletMapProps) {
  const webviewRef = useRef<WebView>(null);
  const html = useMemo(
    () => buildHtml({ latitude, longitude, zoom, interactive }),
    // Intentionally built once — subsequent marker moves happen imperatively via
    // window.setMarker so the WebView (and Leaflet map instance) isn't torn down.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  function handleMessage(event: WebViewMessageEvent) {
    if (!onPick) return;
    try {
      const data = JSON.parse(event.nativeEvent.data);
      onPick({ latitude: data.latitude, longitude: data.longitude });
    } catch {
      // ignore malformed messages
    }
  }

  return (
    <WebView
      ref={webviewRef}
      source={{ html }}
      style={style}
      onMessage={handleMessage}
      scrollEnabled={false}
      originWhitelist={['*']}
    />
  );
}
