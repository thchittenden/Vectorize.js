TEST_FILES := $(wildcard tests/*.js)
TEST_STRINGS := $(patsubst %,<script src="%"></script>,$(TEST_FILES))

all: tests.html

tests.html: $(TEST_FILES) tests.html.template
	sed 's%$$(TESTS)%$(TEST_STRINGS)%' tests.html.template > tests.html

debug:
	@echo "Test Files: $(TEST_FILES)"
	@echo "Test Strings: $(TEST_STRINGS)"

