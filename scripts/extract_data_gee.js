// ============================================================================
// ZERO-DOWNLOAD GEE SCRIPT: LAGOS URBAN HEAT & COVARIATE EXTRACTION
// ============================================================================

// 1. Load Built-In Lagos Administrative Boundaries (UN FAO GAUL Level-2 LGAs)
var wards = ee.FeatureCollection("FAO/GAUL_SIMPLIFIED_500m/2015/level2")
  .filter(ee.Filter.eq('ADM0_NAME', 'Nigeria'))
  .filter(ee.Filter.eq('ADM1_NAME', 'Lagos'));

Map.centerObject(wards, 10);
Map.addLayer(wards, {}, 'Lagos Administrative Units');

// 2. Sentinel-2 L2A (2022–2024 Dry Seasons: Dec–Mar)
function maskS2clouds(image) {
  var scl = image.select('SCL');
  // Exclude cloud shadow (3), medium/high probability clouds (8, 9), and cirrus (10)
  var clearMask = scl.neq(3).and(scl.neq(8)).and(scl.neq(9)).and(scl.neq(10));
  return image.select(['B3', 'B4', 'B8', 'B11']).divide(10000).updateMask(clearMask);
}

var s2 = ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
  .filterBounds(wards)
  .filterDate('2022-12-01', '2024-03-31')
  .filter(ee.Filter.calendarRange(12, 3, 'month'))
  .map(maskS2clouds)
  .median()
  .clip(wards);

var ndvi = s2.normalizedDifference(['B8', 'B4']).rename('ndvi');
var ndbi = s2.normalizedDifference(['B11', 'B8']).rename('ndbi');
var mndwi = s2.normalizedDifference(['B3', 'B11']).rename('mndwi');

// Strict Land Mask: Exclude Lagos Lagoon, creeks, and Atlantic Ocean (MNDWI <= 0)
var landMask = mndwi.lte(0);

// 3. Primary Thermal Layer: Landsat 8/9 Collection 2 LST (30m, Matching Window)
function prepLandsatLST(image) {
  var qa = image.select('QA_PIXEL');
  var clear = qa.bitwiseAnd(1 << 3).eq(0) // Cloud
    .and(qa.bitwiseAnd(1 << 4).eq(0))     // Cloud Shadow
    .and(qa.bitwiseAnd(1 << 1).eq(0));    // Dilated Cloud
  var lst = image.select('ST_B10').multiply(0.00341802).add(149.0).subtract(273.15).rename('mean_lst');
  return lst.updateMask(clear).updateMask(landMask);
}

var landsatLST = ee.ImageCollection("LANDSAT/LC08/C02/T1_L2")
  .merge(ee.ImageCollection("LANDSAT/LC09/C02/T1_L2"))
  .filterBounds(wards)
  .filterDate('2022-12-01', '2024-03-31')
  .filter(ee.Filter.calendarRange(12, 3, 'month'))
  .map(prepLandsatLST)
  .median()
  .clip(wards);

// 4. Independent Cross-Check Layer: MODIS 1km Day LST
var modisLST = ee.ImageCollection("MODIS/061/MOD11A2")
  .filterBounds(wards)
  .filterDate('2022-12-01', '2024-03-31')
  .filter(ee.Filter.calendarRange(12, 3, 'month'))
  .select('LST_Day_1km')
  .median()
  .multiply(0.02).subtract(273.15)
  .updateMask(landMask)
  .rename('modis_lst');

// 5. Copernicus DEM (GLO-30) Elevation & Slope
var demRaw = ee.ImageCollection("COPERNICUS/DEM/GLO30")
  .filterBounds(wards)
  .select('DEM')
  .mosaic()
  .setDefaultProjection('EPSG:4326', null, 30);

var slope = ee.Terrain.slope(demRaw).updateMask(landMask).rename('slope');
var dem = demRaw.updateMask(landMask).rename('elevation');

// 6. WorldPop Gridded Population Count (100m)
var pop = ee.ImageCollection("WorldPop/GP/100m/pop")
  .filterBounds(wards)
  .filter(ee.Filter.eq('country', 'NGA'))
  .filter(ee.Filter.eq('year', 2020))
  .first()
  .rename('population');

// 7. Zonal Reduction: Mean Environmental Metrics (at 30m scale)
var envStack = ee.Image.cat([
  landsatLST, modisLST, 
  ndvi.updateMask(landMask), 
  ndbi.updateMask(landMask), 
  dem, slope
]);

var wardsEnv = envStack.reduceRegions({
  collection: wards,
  reducer: ee.Reducer.mean(),
  scale: 30
});

// 8. Zonal Reduction: Total Population at Native WorldPop Scale
var wardsFinal = pop.reduceRegions({
  collection: wardsEnv,
  reducer: ee.Reducer.sum().setOutputs(['population']),
  crs: pop.projection(),
  scale: pop.projection().nominalScale()
});

// 9. Export Clean GeoJSON to Google Drive
Export.table.toDrive({
  collection: wardsFinal,
  description: 'Export_Lagos_Wards_Raw',
  fileNamePrefix: 'lagos_wards_raw',
  fileFormat: 'GeoJSON'
});
