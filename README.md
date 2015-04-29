# Vectorize.js

Vectorize.js is a javascript library for automatically vectorizing javascript using Mozilla's [SIMD.js](https://github.com/johnmccutchan/ecmascript_simd). Vectorize.js works by converting a function to a string, parsing it with [Esprima](http://esprima.org), transforming it to use SIMD vectors, and regenerating the code using [Escodegen](https://github.com/estools/escodegen).

### Example Usage

Have a function you want to vectorize? It's as easy as this:

```javascript 
vectorFunction = vectorize.me(scalarFunction);
```

Currently Vectorize.js supports the following language features for operating on vectors:
- Binary Operators: +, -, \*, /, <, <=, ==, >=, >
- Unary Operators: ++, --
- Reductions: +, -, \*, /
- Nested loops

We are currently in the process of adding support for:
- Conditionals and Conditional Expressions.
- Inlining and vectorizing function calls.
- min/max operators/reductions.

Vectorize.js relies on the following libraries to process and transform the Javascript:
- [Esprima](http://esprima.org)
- [Escodegen](https://github.com/estools/escodegen)
- [Estraverse](https://github.com/estools/estraverse)
- [Esrecurse](https://github.com/estools/esrecurse)

### Disclaimers

Javascript is a complicated language with lots of features and hence lots of edge cases! Vectorize.js tries its best to not break your functions but we make no guarantees. 
