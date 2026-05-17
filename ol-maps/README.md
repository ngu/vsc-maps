# OL Maps VS Code Extension

This extension scaffolds a custom editor for `.yol` files (YAML) and renders a map in a WebView using OpenLayers.

## Features

- Registers a custom editor for YAML files with `yol` extension (YAML for OpenLayers).
- The frontend is a WebView that renders a map with OpenLayers, the YAML format corresponds OpenLayers' API.
- Panning and zooming updates the view field in the file.

## YOL Model (initial shape)

```yaml
view:
  center: [0, 0]
  zoom: 2
  projection: EPSG:3857
layers:
  - type: tile
    source:
      type: osm
```

Supported layer/source subset:

- Layer `type`: `tile` with tile source `type`: `osm`, `xyz` or `wms`
- Layer `type`: `vector` with tile source `type`: `geojson`, `topojson`, `kml` or `gml`

### XYZ Example

```yaml
view:
  center: [0, 0]
  zoom: 2
layers:
  - type: tile
    source:
      type: xyz
      url: https://tile.openstreetmap.org/{z}/{x}/{y}.png
```

## Run

1. `npm install`
2. `npm run compile`
3. Press `F5` to launch Extension Development Host.
4. Open any `.yol` file.
