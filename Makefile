TEST_FILES := $(wildcard tests/*.js)
TEST_STRINGS := $(patsubst %,<script src="%"></script>,$(TEST_FILES))
SRCS := $(wildcard *.js)

all: bin/vectorize.browser.js 

bin/vectorize.browser.js: $(SRCS)
	@mkdir -p $(@D)
	browserify $^ -o $@

bin/tests.html: $(TEST_FILES) tests.html.template
	@mkdir -p $(@D)
	sed 's%$$(TESTS)%$(TEST_STRINGS)%' tests.html.template > $@

debug:
	@echo "Sources: $(SRCS)"
	@echo "Test Files: $(TEST_FILES)"
	@echo "Test Strings: $(TEST_STRINGS)"

