node compile.js > test.c
gcc array.c hashmap.c gum.c test.c -O3 -o test -lm -pg && time ./test && gprof test > gprof.out
