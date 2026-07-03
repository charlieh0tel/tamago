# Regenerate the worked-example artifacts in designs/.
#
# Each pair derives from its authored .input.json: optimized spec (.json),
# result (.result.json), plot page (.html), and for the circle pair the
# per-band NEC decks. Everything depends on the package sources, so a code
# change re-optimizes on the next make; use -j to parallelize across pairs.
#
# Requires uv, nec2c on PATH, and jq.

PAIRS := circle squircle turnstile balun4
SOURCES := $(wildcard src/awadateki/*.py)

SPECS := $(PAIRS:%=designs/satellite_pair_%.json)
RESULTS := $(PAIRS:%=designs/satellite_pair_%.result.json)
PLOTS := $(PAIRS:%=designs/satellite_pair_%.html)
DECKS := designs/satellite_pair_circle.2m.nec designs/satellite_pair_circle.70cm.nec

all: $(SPECS) $(RESULTS) $(PLOTS) $(DECKS)

designs/satellite_pair_%.json: designs/satellite_pair_%.input.json $(SOURCES)
	uv run awadateki $< --optimize-reflector --emit-spec $@ > /dev/null

designs/satellite_pair_%.result.json: designs/satellite_pair_%.json $(SOURCES)
	uv run awadateki $< --sweep --emit-result $@ > /dev/null

designs/satellite_pair_%.html: designs/satellite_pair_%.json $(SOURCES)
	uv run awadateki $< --plot $@ > /dev/null

designs/satellite_pair_circle.2m.nec: designs/satellite_pair_circle.json $(SOURCES)
	jq '.[0]' $< | uv run awadateki - --deck $@ > /dev/null

designs/satellite_pair_circle.70cm.nec: designs/satellite_pair_circle.json $(SOURCES)
	jq '.[1]' $< | uv run awadateki - --deck $@ > /dev/null

.PHONY: all
.DELETE_ON_ERROR:
# The optimized specs are chained pattern-rule targets; without this make
# treats them as intermediates and deletes them after the derived artifacts.
.SECONDARY:
