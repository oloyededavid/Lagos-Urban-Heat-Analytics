// ============================================================================
// LAGOS URBAN HEAT & COVARIATE EXTRACTION (Google Earth Engine)
// ----------------------------------------------------------------------------
// One feature per Lagos State Local Government Area (LGA, FAO GAUL level 2) with
// dry-season (Dec–Mar, 2022/23 and 2023/24) means of Landsat 8/9 land surface
// temperature, MODIS day LST, Sentinel-2 NDVI/NDBI, Copernicus DEM elevation and
// slope, and WorldPop 2020 population (total and density). Install the export
// with scripts/ingest_gee_export.py; scripts/analyze_uhi.py does the statistics.
// For the four-decade change analysis see scripts/extract_change_gee.py.
// ============================================================================

var SCRIPT_VERSION = '2.0.0';
var EXPORT_UTC = ee.Date(Date.now()).format("YYYY-MM-dd'T'HH:mm:ss'Z'", 'UTC');

// Study window: two dry seasons. filterDate's end is exclusive.
var START = '2022-12-01';
var END = '2024-04-01';

// 1. Lagos LGAs (FAO GAUL 2015, level 2)
var lgas = ee.FeatureCollection('FAO/GAUL_SIMPLIFIED_500m/2015/level2')
  .filter(ee.Filter.eq('ADM0_NAME', 'Nigeria'))
  .filter(ee.Filter.eq('ADM1_NAME', 'Lagos'));

Map.centerObject(lgas, 10);
Map.addLayer(lgas, {}, 'Lagos LGAs');
print('Number of LGAs (expect 20):', lgas.size());

// 2. Sentinel-2 L2A, dry-season median
function maskS2clouds(image) {
  var scl = image.select('SCL');
  // Exclude cloud shadow (3), medium/high-probability cloud (8, 9) and cirrus (10)
  var clearMask = scl.neq(3).and(scl.neq(8)).and(scl.neq(9)).and(scl.neq(10));
  return image.select(['B3', 'B4', 'B8', 'B11']).divide(10000).updateMask(clearMask);
}

var s2Col = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
  .filterBounds(lgas)
  .filterDate(START, END)
  .filter(ee.Filter.calendarRange(12, 3, 'month'));
var s2 = s2Col.map(maskS2clouds).median().clip(lgas);

var ndvi = s2.normalizedDifference(['B8', 'B4']).rename('ndvi');
var ndbi = s2.normalizedDifference(['B11', 'B8']).rename('ndbi');
var mndwi = s2.normalizedDifference(['B3', 'B11']).rename('mndwi');

// Land mask: exclude the Lagos Lagoon, creeks and the Atlantic (MNDWI <= 0 is land)
var landMask = mndwi.lte(0);

// 3. Landsat 8/9 Collection 2 Level-2 land surface temperature (30 m)
function prepLandsatLST(image) {
  var qa = image.select('QA_PIXEL');
  var clear = qa.bitwiseAnd(1 << 3).eq(0)   // cloud
    .and(qa.bitwiseAnd(1 << 4).eq(0))       // cloud shadow
    .and(qa.bitwiseAnd(1 << 1).eq(0));      // dilated cloud
  var lst = image.select('ST_B10').multiply(0.00341802).add(149.0).subtract(273.15).rename('mean_lst');
  return lst.updateMask(clear).updateMask(landMask);
}

var landsatCol = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
  .merge(ee.ImageCollection('LANDSAT/LC09/C02/T1_L2'))
  .filterBounds(lgas)
  .filterDate(START, END)
  .filter(ee.Filter.calendarRange(12, 3, 'month'));
var landsatLST = landsatCol.map(prepLandsatLST).median().clip(lgas);

// 4. Independent cross-check: MODIS Terra 8-day day LST (1 km)
var modisCol = ee.ImageCollection('MODIS/061/MOD11A2')
  .filterBounds(lgas)
  .filterDate(START, END)
  .filter(ee.Filter.calendarRange(12, 3, 'month'))
  .select('LST_Day_1km');
var modisLST = modisCol.median()
  .multiply(0.02).subtract(273.15)
  .updateMask(landMask)
  .rename('modis_lst');

// 5. Copernicus DEM GLO-30 elevation and slope. mosaic() drops the native 30 m
// projection, so restore it before computing slope.
var glo30 = ee.ImageCollection('COPERNICUS/DEM/GLO30_2024_1').select('DEM');
var demRaw = glo30.filterBounds(lgas).mosaic().setDefaultProjection(glo30.first().projection());
var slope = ee.Terrain.slope(demRaw).updateMask(landMask).rename('slope');
var dem = demRaw.updateMask(landMask).rename('elevation');

// 6. WorldPop 2020 population count (100 m)
var pop = ee.ImageCollection('WorldPop/GP/100m/pop')
  .filterBounds(lgas)
  .filter(ee.Filter.eq('country', 'NGA'))
  .filter(ee.Filter.eq('year', 2020))
  .first()
  .rename('population');

// 7. Zonal means of the environmental layers (30 m)
var envStack = ee.Image.cat([
  landsatLST, modisLST,
  ndvi.updateMask(landMask),
  ndbi.updateMask(landMask),
  dem, slope,
  landMask.rename('land_fraction')
]);

var lgasEnv = envStack.reduceRegions({
  collection: lgas,
  reducer: ee.Reducer.mean(),
  scale: 30,
  tileScale: 4
});

// 8. Total population at WorldPop's native scale
var lgasPop = pop.reduceRegions({
  collection: lgasEnv,
  reducer: ee.Reducer.sum().setOutputs(['population']),
  crs: pop.projection(),
  scale: pop.projection().nominalScale()
});

// 9. Tidy attributes: names, areas, density and provenance
var lgasFinal = lgasPop.map(function(f) {
  var areaKm2 = f.geometry().area(10).divide(1e6);
  var landKm2 = areaKm2.multiply(ee.Number(f.get('land_fraction')));
  return ee.Feature(f.geometry(), {
    'lga_name': f.get('ADM2_NAME'),
    'lga_code': f.get('ADM2_CODE'),
    'area_km2': areaKm2,
    'land_area_km2': landKm2,
    'population': f.get('population'),
    'pop_density': ee.Number(f.get('population')).divide(landKm2.max(0.01)),
    'mean_lst': f.get('mean_lst'),
    'modis_lst': f.get('modis_lst'),
    'ndvi': f.get('ndvi'),
    'ndbi': f.get('ndbi'),
    'elevation': f.get('elevation'),
    'slope': f.get('slope'),
    'landsat_scenes': landsatCol.size(),
    's2_scenes': s2Col.size(),
    'modis_images': modisCol.size(),
    'period': START + '/' + END,
    'export_utc': EXPORT_UTC,
    'script_version': SCRIPT_VERSION,
    'data_status': 'GEE_EXPORT'
  });
});

// 10. Export GeoJSON to Google Drive
Export.table.toDrive({
  collection: lgasFinal,
  description: 'lagos_lgas_raw',
  fileNamePrefix: 'lagos_lgas_raw',
  fileFormat: 'GeoJSON'
});
