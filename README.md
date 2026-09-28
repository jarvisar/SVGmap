# SVGmap

Make SVG maps of any city from OpenStreetMap data, for laser engraving, pen plotters or print. Everything runs in the browser.

Visit the [GitHub Pages site](https://svgmap.ajarvis.co/) to access the latest deployment.

<p align="center">
  <img src="docs/screenshot.png" alt="SVGmap preview of downtown Chicago"/>
</p>

## How to Use

Search for a place or pick one of the example cities. Drag the map to move the frame, scroll to zoom and right-drag to rotate. On a phone, pinch to zoom and twist to rotate. The frame shows the whole piece, including the margins, border and title.

Click `Generate` to build the SVG. The preview updates as you change settings. Scroll or pinch to zoom the preview and drag to move it. Double-click it or click `Fit` to see the whole piece again. Click `Download SVG` to save the file, or `Share` to copy a link with your settings.

Settings are saved in the browser. `Reset settings` at the bottom of the sidebar puts everything back to the defaults except the location and title.

The settings are:

* Location sets the area. Map width and scale are two ways of saying the same thing.
* Size sets the piece: a preset (plaques, paper sizes, coasters) or your own width and height, the shape (rectangle, rounded or circle), the blank margin inside the cut and the border.
* Output switches between laser, plotter and print.
* Layers turns each kind of feature on or off, sets its colour and how filled areas are drawn (fill, outline or hatching).
* Title adds a box or a full-width band with a title and subtitle. You can load your own font file.
* Line cleanup removes doubled and crowded lines. See below.
* Map data sets where the map tiles come from.

## Install & Offline Use

SVGmap can be installed as an app. Chrome, Edge and Android show an `Install` prompt at the bottom of the page. The install button in the address bar or browser menu works too. On an iPhone or iPad, tap `Share` and then `Add to Home Screen`.

The app and the title fonts are saved on the first visit, so it opens without a connection. Map tiles are saved as you use them (the last 500 tiles, for up to 30 days), so areas you've already viewed can be generated again offline. Place search always needs a connection, and tiles from a custom source under Map data aren't saved.

When a new version is deployed, a notice asks you to reload. It never reloads on its own.

## Output Modes

* Laser: filled areas engrave, lines score and the edge cuts. Every layer gets its own colour so it can get its own process. The `LightBurn layer palette` option uses LightBurn's colours so each layer lands on its own LightBurn layer, and `Minimal` gives three processes (engrave, score, cut).
* Plotter: everything is a stroke. Filled areas are hatched and the strokes are ordered to cut down pen-up travel. Each pen colour becomes a numbered layer (`1 - pen #000000`) that AxiDraw, vpype and saxi can split on. Single-line Hershey fonts are included for titles.
* Print: coloured themes with wider lines for bigger roads.

The file is sized in millimetres. Check the imported size in your laser software matches the size shown under the preview.

## Line Cleanup

Two lines closer together than the laser beam burn as one dark band. The cleanup comes from my Blender add-on and does the following, in order:

* Joins pieces of the same street into one line
* Removes lines that run close and parallel to a more important one (sidewalks next to roads, doubled tracks)
* Shrinks tiny roundabouts into junctions, since they burn as dots
* Closes small gaps where paths stop just short of a road
* Removes tangles of footpaths that are too dense to read
* Thins out dense patches, but never removes residential streets or anything more important
* Removes short dead ends

A road is never removed in favour of a less important one. The preview shows how much of the road network was kept, and a warning appears below 97%.

`Line spacing` is the main setting. Set it to about your beam width, or 1.5 to 2 times your pen width. The presets change it for each output mode.

## Local Installation

1. Clone the repository:

	`git clone https://github.com/jarvisar/SVGmap.git`

2. Install the dependencies:

	`npm install`

3. Start the dev server:

	`npm run dev`

Run the tests with `npm test`. The live render test is skipped unless `SVGMAP_NETWORK=1` is set.

`npm run build` puts the site in `dist`. Pushing to `main` builds and deploys it with GitHub Actions (`.github/workflows/deploy.yml`). In the repository settings under Pages, the source needs to be set to GitHub Actions.

## Known Issues & Limitations

* Areas that need more than 400 map tiles use less detailed tiles, so small features can be missing. A city center at the default scale needs 4 to 12. The limit can be raised to 2000 under Map data.
* Map tiles store coordinates to about half a metre. At large scales (under about 1:5000) curves can look slightly angular.
* The tiles don't mark sidewalks, so they can't be removed by tag. The cleanup removes most of them because they run next to a road.
* Only SVG export is supported. There is no DXF.
* Custom fonts can be TTF, OTF or WOFF. WOFF2 files don't load.
* The wood preview is only a rough idea of how the fills will look. Test your settings on scrap.
* On the very first visit, the map style loads before the service worker starts, so it isn't saved until the next visit. Going offline right after a first visit can leave the map blank, but generating still works for tiles that were loaded.

###### Note: map data is from OpenStreetMap. Credit "© OpenStreetMap contributors" on anything you publish or sell.

## Credits

* Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors
* Vector tiles from [OpenFreeMap](https://openfreemap.org) in the [OpenMapTiles](https://openmaptiles.org) schema
* Place search by [Photon](https://photon.komoot.io)
* [MapLibre GL JS](https://maplibre.org), [Clipper2](https://github.com/countertype/clipper2-ts), [opentype.js](https://opentype.js.org) and [pmtiles](https://github.com/protomaps/PMTiles)
* Fonts: Montserrat, Josefin Sans, Cinzel, Oswald, Bebas Neue and Bitter, under the SIL Open Font License (see `public/fonts`)
* The Hershey Fonts were originally created by Dr. A. V. Hershey while working at the U.S. National Bureau of Standards. The format of the font data was originally created by James Hurt, Cognition, Inc. Glyph data from [hersheytext](https://github.com/techninja/hersheytextjs).
