/*  London — example city config for Gesture City Map.
    A small set of well-known places to show how little you need. Pins are approximate. */
window.CITY_CONFIG = {
  name: "London",
  title: "London Constellation",
  subtitle: "example city: swap in your own",
  center: [51.5072, -0.1276],
  homeZoom: 1,
  theme: { accent: "#7cf3ff", accent2: "#ff5cf0" },

  categories: {
    sights:  { label: "Landmarks",         color: "#fff1a8", icon: "🏛️" },
    museums: { label: "Museums & Galleries", color: "#b794ff", icon: "🖼️" },
    markets: { label: "Markets & Food",    color: "#ff8a3d", icon: "🥐" },
    parks:   { label: "Parks",             color: "#3ddc84", icon: "🌳" },
    areas:   { label: "Neighbourhoods",    color: "#7dd3fc", icon: "◎" },
    rail:    { label: "Stations",          color: "#ff5c5c", icon: "🚆" },
    stadium: { label: "Stadiums",          color: "#ffe066", icon: "🏟️" },
  },

  places: [
    { name: "Big Ben",               cat: "sights",  lat: 51.5007, lng: -0.1246, rank: 3, area: "Westminster", note: "The clock tower of the Houses of Parliament." },
    { name: "London Eye",            cat: "sights",  lat: 51.5033, lng: -0.1196, rank: 3, area: "South Bank", note: "Giant observation wheel on the Thames." },
    { name: "Buckingham Palace",     cat: "sights",  lat: 51.5014, lng: -0.1419, rank: 3, area: "Westminster", note: "The monarch's London residence." },
    { name: "Tower of London",       cat: "sights",  lat: 51.5081, lng: -0.0759, rank: 3, area: "City", note: "Medieval fortress that holds the Crown Jewels." },
    { name: "Tower Bridge",          cat: "sights",  lat: 51.5055, lng: -0.0754, rank: 2, area: "City", note: "Victorian bascule bridge with a glass walkway." },
    { name: "St Paul's Cathedral",   cat: "sights",  lat: 51.5138, lng: -0.0984, rank: 2, area: "City", note: "Wren's dome, with a whispering gallery." },
    { name: "The Shard",             cat: "sights",  lat: 51.5045, lng: -0.0865, rank: 2, area: "London Bridge", note: "The tallest building in the UK." },
    { name: "Trafalgar Square",      cat: "sights",  lat: 51.5080, lng: -0.1281, rank: 2, area: "Westminster", note: "Nelson's Column and the National Gallery." },
    { name: "British Museum",        cat: "museums", lat: 51.5194, lng: -0.1270, rank: 3, area: "Bloomsbury", note: "World history under one roof, free entry." },
    { name: "Tate Modern",           cat: "museums", lat: 51.5076, lng: -0.0994, rank: 2, area: "Bankside", note: "Modern art in a former power station." },
    { name: "Natural History Museum",cat: "museums", lat: 51.4967, lng: -0.1764, rank: 2, area: "South Kensington", note: "Dinosaurs and a blue whale skeleton." },
    { name: "Borough Market",        cat: "markets", lat: 51.5055, lng: -0.0910, rank: 2, area: "Southwark", note: "London's best-known food market." },
    { name: "Camden Market",         cat: "markets", lat: 51.5413, lng: -0.1460, rank: 2, area: "Camden", note: "Street food and stalls along the canal." },
    { name: "Covent Garden",         cat: "markets", lat: 51.5117, lng: -0.1240, rank: 2, area: "West End", note: "Piazza with street performers." },
    { name: "Brick Lane",            cat: "markets", lat: 51.5216, lng: -0.0717, rank: 1, area: "Shoreditch", note: "Curry houses, bagels and vintage shops." },
    { name: "Hyde Park",             cat: "parks",   lat: 51.5073, lng: -0.1657, rank: 3, area: "Westminster", note: "The Serpentine, Speakers' Corner and lots of grass." },
    { name: "Regent's Park",         cat: "parks",   lat: 51.5313, lng: -0.1570, rank: 2, area: "Marylebone", note: "Rose gardens and London Zoo." },
    { name: "Greenwich Park",        cat: "parks",   lat: 51.4769, lng: -0.0005, rank: 2, area: "Greenwich", note: "Home of the Royal Observatory and the prime meridian." },
    { name: "Soho",                  cat: "areas",   lat: 51.5136, lng: -0.1365, rank: 2, area: "West End", note: "Theatres, bars and late-night food." },
    { name: "Shoreditch",            cat: "areas",   lat: 51.5265, lng: -0.0798, rank: 2, area: "East", note: "Street art and the tech scene." },
    { name: "Canary Wharf",          cat: "areas",   lat: 51.5054, lng: -0.0235, rank: 2, area: "Docklands", note: "The financial district's towers." },
    { name: "King's Cross",          cat: "rail",    lat: 51.5308, lng: -0.1238, rank: 2, area: "Camden", note: "Trains north, and Platform 9 3/4 for photos." },
    { name: "Paddington",            cat: "rail",    lat: 51.5154, lng: -0.1755, rank: 1, area: "Westminster", note: "Trains west and the Heathrow Express." },
    { name: "Waterloo",              cat: "rail",    lat: 51.5031, lng: -0.1132, rank: 1, area: "South Bank", note: "The UK's busiest station." },
    { name: "Liverpool Street",      cat: "rail",    lat: 51.5178, lng: -0.0823, rank: 1, area: "City", note: "Trains east and to Stansted." },
    { name: "Wembley Stadium",       cat: "stadium", lat: 51.5560, lng: -0.2796, rank: 2, area: "Wembley", note: "England's national football stadium." },
    { name: "Lord's",                cat: "stadium", lat: 51.5294, lng: -0.1727, rank: 1, area: "St John's Wood", note: "The home of cricket." },
  ],

  lines: [
    { name: "River Thames", kind: "water", points: [[51.4835,-0.2100],[51.4840,-0.1800],[51.4855,-0.1500],[51.4870,-0.1270],[51.4950,-0.1230],[51.5020,-0.1215],[51.5080,-0.1180],[51.5105,-0.1060],[51.5090,-0.0920],[51.5075,-0.0800],[51.5050,-0.0650],[51.5040,-0.0480],[51.5080,-0.0330],[51.5000,-0.0170],[51.4890,-0.0110],[51.4870,0.0000],[51.4960,0.0060],[51.5050,0.0050]] },
  ],
};
