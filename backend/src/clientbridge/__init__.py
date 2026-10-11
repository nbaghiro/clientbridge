import zoneinfo

# Zones come from the pinned tzdata package, not host zone files that may predate a rule change.
zoneinfo.reset_tzpath(to=[])
