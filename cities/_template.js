/*  City config template for Gesture City Map
    ------------------------------------------------------------------
    1. Copy this file to cities/<your-city>.js  (lowercase, no spaces: cities/pune.js)
    2. Fill in the fields below. Only name, categories and places are required.
    3. Open index.html?city=<your-city>  — or set data-city="<your-city>" in index.html
       to make it the default.

    Tip: get coordinates by right-clicking any spot in Google Maps; the first item
    in the menu is "lat, lng". Or build a CSV and convert it:
        node tools/csv-to-city.mjs my-places.csv > cities/<your-city>.js
*/
window.CITY_CONFIG = {
  name: "My City",                       // used in the intro: "Fly My City with your hands"
  title: "My City Constellation",        // top-left title (optional)
  subtitle: "the places I love",         // small line under the title (optional)
  credit: "by Your Name",                // shown after the subtitle (optional)
  center: [12.9716, 77.5946],            // [lat, lng] the map is measured from (optional: defaults to the middle of your places)
  homeZoom: 1,                           // >1 starts closer in, <1 starts further out (optional)
  theme: { accent: "#7cf3ff", accent2: "#ff5cf0" },   // UI colours (optional)

  // Each category becomes its own constellation. key: { label, color, icon }
  categories: {
    food:  { label: "Food",           color: "#ff8a3d", icon: "🍛" },
    parks: { label: "Parks & Lakes",  color: "#3ddc84", icon: "🌳" },
    sights:{ label: "Landmarks",      color: "#fff1a8", icon: "🏛️" },
  },

  // rank: 3 = always labelled, 2 = labelled when zoomed in a bit, 1 = only when zoomed in a lot.
  // approx: true adds an "approximate pin" note to the card.
  places: [
    { name: "Cubbon Park",   cat: "parks",  lat: 12.9763, lng: 77.5929, rank: 3, area: "Central", note: "Big green lung in the middle of the city." },
    { name: "Vidhana Soudha",cat: "sights", lat: 12.9791, lng: 77.5913, rank: 3, area: "Central", note: "The state legislature, lit up on Sundays." },
    { name: "MTR",           cat: "food",   lat: 12.9552, lng: 77.5857, rank: 2, area: "Lalbagh Road", note: "Classic South Indian breakfast since 1924." },
    // Short form also works: [name, cat, lat, lng, rank, area, note, approx]
    ["Lalbagh", "parks", 12.9507, 77.5848, 3, "South", "Botanical garden with a glass house."],
  ],

  // Optional lines: transit (with named stops), roads, rivers.
  //   transit: stops: [[name, lat, lng], ...]
  //   road / water: points: [[lat, lng], ...], loop: true closes the shape
  lines: [
    { name: "Purple Line", color: "#b06cff", kind: "transit", stops: [["Vidhana Soudha", 12.9798, 77.5926], ["MG Road", 12.9755, 77.6067]] },
  ],
};
