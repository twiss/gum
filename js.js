var Infinity = INFINITY;
var console = {
	log: function(arg) {
		printf("%s\n", arg + '');
	}
};
var Math = {
	PI: 3.141592653589793,
	ceil: function(n) {
		return +ceil(n);
	},
	sqrt: function(n) {
		return +sqrt(n);
	}
};
function parseInt(str, base) {
	if(base == 10) return atol(str);
	return NAN;
}
var process = {
	argc: argc,
	argv: argv
};