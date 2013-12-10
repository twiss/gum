var Infinity = INFINITY;
var console = {
	log: function(arg) {
		printf("%s\n", arg + '');
	}
};
var Math = {
	ceil: function(n) {
		return +ceil(n);
	},
	sqrt: function(n) {
		return +sqrt(n);
	}
};