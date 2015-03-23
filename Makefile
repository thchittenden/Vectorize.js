TEST_FILES := $(wildcard tests/*.js)
TEST_STRINGS := $(patsubst %,<script src="%"></script>,$(TEST_FILES))

all: tests.html

tests.html: tests.html.template
	sed 's/$$(TESTS)/$(TEST_STRINGS)/g' > tests.html

debug:
	@echo "Test Files: $(TEST_FILES)"
	@echo "Test Strings: $(TEST_STRINGS)"

.PHONY: tests.html.template
