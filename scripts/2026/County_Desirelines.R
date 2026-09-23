library(dplyr)
library(tidyr)
library(purrr)
library(sf)
library(classInt)
library(RColorBrewer) 
library(leaflet)

process_one_year <- function(tripData, scenario_name) {
  
  county_coords_join <- county_coords %>%
    st_drop_geometry() %>%
    mutate(
      GEOID = sprintf("%05.0f", as.numeric(GEOID))
    ) %>%
    select(GEOID, Long, Lat)
  
  tripData <- tripData %>%
    mutate(
      orig_taz = clean_id(orig_taz),
      dest_taz = clean_id(dest_taz),
      num_participants = suppressWarnings(as.numeric(num_participants)),
      tour_participants = suppressWarnings(as.numeric(tour_participants)),
      
      participants = case_when(
        !is.na(num_participants) & num_participants > 0 ~ num_participants,
        !is.na(tour_participants) & tour_participants > 0 ~ tour_participants,
        TRUE ~ NA_real_
      ),
      
      mode_class = case_when(
        trip_mode_name %in% c("DRIVEALONEFREE", "DRIVEALONEPAY") ~ "SOV",
        trip_mode_name %in% c("SHARED2FREE", "SHARED2PAY", "SHARED3FREE", "SHARED3PAY") ~ "HOV",
        trip_mode_name %in% c(
          "PNR_ALLTRN", "PNR_PRMTRN",
          "KNR_ALLTRN", "KNR_PRMTRN",
          "WALK_ALLTRN", "WALK_PRMTRN"
        ) ~ "TRN",
        trip_mode_name == "WALK" ~ "WALK",
        trip_mode_name == "BIKE" ~ "BIKE",
        TRUE ~ "OTHER"
      ),
      
      trip_class = case_when(
        grepl("^work_", tolower(tour_purpose)) ~ "WRK",
        grepl("^atwork_", tolower(tour_purpose)) ~ "WRK",
        tolower(orig_purpose) %in% c("work", "atwork") ~ "WRK",
        tolower(dest_purpose) %in% c("work", "atwork") ~ "WRK",
        TRUE ~ "NWK"
      )
    )
  
  trip_county <- tripData %>%
    left_join(
      TAZcrosswalk_clean %>%
        mutate(MTAZ10 = clean_id(MTAZ10)) %>%
        select(MTAZ10, ORIG_FIPS = FIPS, origin_county = COUNTY),
      by = c("orig_taz" = "MTAZ10")
    ) %>%
    left_join(
      TAZcrosswalk_clean %>%
        mutate(MTAZ10 = clean_id(MTAZ10)) %>%
        select(MTAZ10, DEST_FIPS = FIPS, destination_county = COUNTY),
      by = c("dest_taz" = "MTAZ10")
    )
  
  county_od <- trip_county %>%
    mutate(
      ORIG_FIPS = sprintf("%05.0f", as.numeric(ORIG_FIPS)),
      DEST_FIPS = sprintf("%05.0f", as.numeric(DEST_FIPS)),
      
      person_weight = case_when(
        mode_class == "HOV" & !is.na(participants) & participants > 0 ~ participants,
        mode_class %in% c("SOV", "TRN", "WALK", "BIKE") ~ 1,
        TRUE ~ NA_real_
      )
    ) %>%
    filter(
      !is.na(ORIG_FIPS),
      !is.na(DEST_FIPS),
      !is.na(person_weight)
    ) %>%
    group_by(ORIG_FIPS, DEST_FIPS, origin_county, destination_county) %>%
    summarise(
      ALLALL  = sum(person_weight, na.rm = TRUE),
      WRKALL  = sum(if_else(trip_class == "WRK", person_weight, 0), na.rm = TRUE),
      NWKALL  = sum(if_else(trip_class == "NWK", person_weight, 0), na.rm = TRUE),
      ALLSOV  = sum(if_else(mode_class == "SOV", person_weight, 0), na.rm = TRUE),
      ALLHOV  = sum(if_else(mode_class == "HOV", person_weight, 0), na.rm = TRUE),
      ALLTRN  = sum(if_else(mode_class == "TRN", person_weight, 0), na.rm = TRUE),
      ALLWALK = sum(if_else(mode_class == "WALK", person_weight, 0), na.rm = TRUE),
      ALLBIKE = sum(if_else(mode_class == "BIKE", person_weight, 0), na.rm = TRUE),
      .groups = "drop"
    ) %>%
    left_join(
      county_coords_join,
      by = c("ORIG_FIPS" = "GEOID")
    ) %>%
    rename(
      Origin_Long = Long,
      Origin_Lat = Lat
    ) %>%
    left_join(
      county_coords_join,
      by = c("DEST_FIPS" = "GEOID")
    ) %>%
    rename(
      Dest_Long = Long,
      Dest_Lat = Lat
    ) %>%
    filter(
      !is.na(Origin_Long),
      !is.na(Origin_Lat),
      !is.na(Dest_Long),
      !is.na(Dest_Lat)
    )
  
  write.csv(
    county_od,
    paste0("County_Desirelines_", scenario_name, ".csv"),
    row.names = FALSE
  )
  
  return(county_od)
}
  


YEAR <- "2020"

tripData <- get(paste0("tripData_", YEAR))

result <- process_one_year(tripData, YEAR)

ABM_Desireline <- result %>%
  drop_na(ALLALL, Origin_Long, Origin_Lat, Dest_Long, Dest_Lat) %>%
  mutate(
    geometry = pmap(
      list(Origin_Long, Origin_Lat, Dest_Long, Dest_Lat),
      function(x1, y1, x2, y2) {
        st_linestring(matrix(c(x1, y1, x2, y2), ncol = 2, byrow = TRUE))
      }
    )
  ) %>%
  st_sf(crs = 4326)

kmeans_classes <- classIntervals(
  ABM_Desireline$ALLALL,
  n = 6,
  style = "kmeans"
)

kmeans_labels <- paste0(
  formatC(head(kmeans_classes$brks, -1), format = "f", big.mark = ",", digits = 0),
  " – ",
  formatC(tail(kmeans_classes$brks, -1), format = "f", big.mark = ",", digits = 0)
)

ABM_Desireline <- ABM_Desireline %>%
  mutate(
    class_range = cut(
      ALLALL,
      breaks = kmeans_classes$brks,
      include.lowest = TRUE,
      labels = kmeans_labels
    ),
    class_index = as.numeric(class_range)
  ) %>%
  arrange(ALLALL)

line_weights <- c(1, 3, 6, 9, 12, 15)

ABM_Desireline <- ABM_Desireline %>%
  mutate(
    line_weight = line_weights[class_index]
  )

class_colors <- brewer.pal(n = 6, name = "YlOrRd")

pal <- colorFactor(
  palette = class_colors,
  domain = ABM_Desireline$class_range,
  ordered = TRUE
)

leaflet(ABM_Desireline) %>%
  addProviderTiles(providers$CartoDB.Positron) %>%
  addPolylines(
    color = ~pal(class_range),
    weight = ~line_weight,
    opacity = 0.95,
    popup = ~paste0(
      "<b>", origin_county, "</b> → <b>", destination_county, "</b><br/>",
      "ALLALL: ", formatC(ALLALL, big.mark = ",", format = "f", digits = 0), "<br/>",
      "WRKALL: ", formatC(WRKALL, big.mark = ",", format = "f", digits = 0), "<br/>",
      "NWKALL: ", formatC(NWKALL, big.mark = ",", format = "f", digits = 0), "<br/>",
      "ALLSOV: ", formatC(ALLSOV, big.mark = ",", format = "f", digits = 0), "<br/>",
      "ALLHOV: ", formatC(ALLHOV, big.mark = ",", format = "f", digits = 0), "<br/>",
      "ALLTRN: ", formatC(ALLTRN, big.mark = ",", format = "f", digits = 0), "<br/>",
      "ALLWALK: ", formatC(ALLWALK, big.mark = ",", format = "f", digits = 0), "<br/>",
      "ALLBIKE: ", formatC(ALLBIKE, big.mark = ",", format = "f", digits = 0)
    )
  ) %>%
  addLegend(
    "bottomright",
    pal = pal,
    values = ~class_range,
    title = "Trips (ALLALL)"
  ) %>%
  addLabelOnlyMarkers(
    data = counties,
    lng = ~Long,
    lat = ~Lat,
    label = ~Name,
    labelOptions = labelOptions(
      noHide = TRUE,
      direction = "top",
      textOnly = TRUE,
      style = list(
        "font-weight" = "bold",
        "font-size" = "12px",
        "color" = "#333"
      )
    )
  )

