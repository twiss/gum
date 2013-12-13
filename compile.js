var fs = require('fs');

var acorn = require('tern/node_modules/acorn/acorn');
var walk = require('tern/node_modules/acorn/util/walk');
var infer = require('tern/lib/infer');
var def = require('tern/lib/def');
def.init(def, infer);

var context = new infer.Context();
context.int = new infer.Prim(context.protos.Number, 'int');
infer.withContext(context, function() {
	def.load(JSON.parse(fs.readFileSync('cstdlib.json')), context.topScope);
});

var source = fs.readFileSync('js.js') + fs.readFileSync(process.argv[2]);

var ast = acorn.parse(source, {locations: true});
infer.withContext(context, function() { infer.analyze(ast, 'source'); });

context.topScope.node = ast;
var state = {output: [], scope: context.topScope};

function binopIsInteger(op) {
	return op == '|' || op == '&' || op == '^' || op == '<<' || op == '>>' || op == '>>>';
}

function typeOf(node, state) {
	if(node.typeOf) return node.typeOf;
	var type;
	if(node.type == 'Literal' && typeof node.value == 'number' && node.value % 1 == 0) return node.typeOf = context.int;
	if(node.type == 'BinaryExpression') {
		if(binopIsInteger(node.operator)) return node.typeOf = context.int;
		if(node.operator != '/' && typeOf(node.left, state) == context.int && typeOf(node.right, state) == context.int) return node.typeOf = context.int;
	}
	infer.withContext(context, function() {
		type = infer.expressionType({node: node, state: state.scope});
		type = type.getType ? type.getType(false) : type;
		if(type == context.num && node.type == 'Identifier' && node.name != 'Infinity' && node.name != 'INFINITY') {
			var name = node.name;
			if(!state.scope.fnType || state.scope.fnType.argNames.indexOf(name) == -1) {
				node.typeOf = context.int;
				var NotAnInt = {};
				try {
					walk.recursive(state.scope.node, null, {
						AssignmentExpression: function(node) {
							if(node.left.name == name && typeOf(node.right, state) != context.int) throw NotAnInt;
						},
						VariableDeclaration: function(node, state, cont) {
							node.declarations.forEach(function(node) {
								cont(node, state);
							});
						},
						VariableDeclarator: function(node) {
							if(node.id.name == name && node.init && typeOf(node.init, state) != context.int) throw NotAnInt;
						},
						/*CallExpression: function(node) {
							node.arguments.forEach(function(arg, i) {
								if(arg.name == name && typeOf(node, state).args[i].getType(false) != context.int) throw NotAnInt;
							});
						}*/
					});
					type = context.int;
				} catch(e) {
					if(e == NotAnInt) {}
					else throw e;
				}
			}
		}
	});
	infer.resetGuessing(false);
	return node.typeOf = type;
}

function isConstId(node, state) {
	var NotAConst = {};
	var namenode = node;
	var name = node.name;
	if(state.scope == context.topScope && (name == 'argc' || name == 'argv')) return false;
	
	try {
		walk.simple(state.scope.node, {
			AssignmentExpression: function(node) {
				walk.simple(node.left, {
					Identifier: function(node) {
						if(node.name == name) throw NotAConst;
					},
				});
			},
			VariableDeclaration: function(node) {
				node.declarations.forEach(function(node) {
					if(node.id.name == name && node.init) {
						walk.recursive(node.init, null, {
							MemberExpression: function(node) {
								throw NotAConst;
							},
							Identifier: function(node) {
								if(!isConstId(node, state)) throw NotAConst;
							},
						});
					}
				});
			},
			UpdateExpression: function(node) {
				if(node.argument.name == name) throw NotAConst;
			},
			CallExpression: function(node) {
				node.arguments.forEach(function(node, i) {
					walk.simple(node, {
						Identifier: function(node) {
							if(node.name == name) throw NotAConst;
						},
					});
				});
			},
		});
	} catch(e) {
		if(e == NotAConst) return false;
		else throw e;
	}
	return true;
}

var structDefs = {};
function writeCType(type, state, writeid, constant, length) {
	function writeconst() {
		if(constant) {
			write('const', state);
		}
	}
	if(!type) {
		write('JSValue', state);
		writeid();
		return;
	}
	if(type.proto == context.protos.Array) {
		writeCType(type.props['<i>'].getType(false), state, function() {
			if(!length) {
				write('*', state);
			}
			writeid();
			if(length) {
				write('[', state);
				write(length, state);
				write(']', state);
			}
		}, constant);
		return;
	}
	if(type.proto == context.protos.Function) {
		writeCType(type.retval.getType(false), state, function() {
			write('(*', state);
			writeid();
			write(')', state);
		});
		write('(', state);
		type.args.forEach(function(arg, i) {
			if(i) write(',', state);
			writeCType(arg.getType(false), state, function() {
				write(type.argNames[i], state);
			});
		});
		write(')', state);
		return;
	}
	if(type.props) {
		var keys = Object.keys(type.props);
		var props = JSON.stringify([keys, keys.map(function(prop) {
			return type.props[prop].getType(false) + '';
		})]);
		if(!structDefs[props]) {
			structDefs[props] = newId('_struct');
			write('typedef struct {', state);
			Object.getOwnPropertyNames(type.props).forEach(function(prop) {
				writeCType(type.props[prop].getType(false), state, function() {
					write(prop, state);
				});
				write(';\n', state);
			});
			write('}', state);
			write(structDefs[props], state);
			write(';', state);
		}
		writeconst();
		write(structDefs[props], state);
	} else {
		writeconst();
		switch(type) {
			case context.num: write('double', state); break;
			case context.int: write('long', state); break;
			case context.bool: write('bool', state); break;
			case context.str: write('char*', state); break;
			case null: case undefined: write('JSValue', state); break;
			default: throw new TypeError('Unknown type: ' + type);
		}
	}
	writeid();
}

function writeCast(node, toType, state, cont, fromType) {
	var fromType = fromType !== undefined ? fromType : typeOf(node, state);
	if(fromType == toType || fromType && toType && fromType.proto == toType.proto) {
		return cont(node, state);
	}
	if(toType && toType.proto == context.protos.Function) {
		switch(fromType) {
			case null: case undefined: write('JSValue_FUNCTION(', state); cont(node, state); write(')', state); break;
			default: throw new TypeError('Unknown type: ' + fromType);
		}
		return;
	}
	if(toType && toType.proto == context.protos.Array) {
		switch(fromType) {
			case null: case undefined: write('JSValue_ARRAY(', state); cont(node, state); write(')', state); break;
			default: throw new TypeError('Unknown type: ' + fromType);
		}
		return;
	}
	if(toType && toType.proto == context.protos.Object) {
		switch(fromType) {
			case null: case undefined: write('JSValue_OBJECT(', state); cont(node, state); write(')', state); break;
			default: throw new TypeError('Unknown type: ' + fromType);
		}
		return;
	}
	switch(toType) {
		case context.str: writeToString(node, state, cont); break;
		case context.num: writeToValue(node, state, cont); break;
		case context.bool:
			switch(fromType) {
				case context.bool: cont(node, state); break;
				default: throw new TypeError('Unknown type: ' + fromType);
			}
			break;
		case null: case undefined:
			if(fromType && fromType.proto == context.protos.Function) {
				write('JS_FUNCTION(', state);
				cont(node, state);
				write(')', state);
				return;
			}
			if(fromType && fromType.proto == context.protos.Array) {
				write('JS_ARRAY(', state);
				cont(node, state);
				write(')', state);
				return;
			}
			if(fromType && fromType.proto == context.protos.Object) {
				return cont(node, state);
			}
			switch(fromType) {
				case context.str: write('JS_STRING(', state); cont(node, state); write(')', state); break;
				case context.num: write('JS_NUMBER(', state); cont(node, state); write(')', state); break;
				case null: case undefined: cont(node, state); break;
				default: throw new TypeError('Unknown type: ' + fromType);
			}
			break;
		default: throw new TypeError('Unknown type conversion: ' + fromType + ' to ' + toType);
	}
}

function writeToString(node, state, cont) {
	switch(typeOf(node, state)) {
		case context.str: cont(node, state); break;
		case context.int: write('HPRINTF("%ld", ', state); cont(node, state); write(')', state); break;
		case context.num: write('HPRINTF("%f", ', state); cont(node, state); write(')', state); break;
		case null: case undefined: write('JSValue_STR(', state); cont(node, state); write(')', state); break;
		default: throw new TypeError('Unknown type: ' + typeOf(node, state));
	}
}

function writeToValue(node, state, cont) {
	switch(typeOf(node, state)) {
		case context.int: cont(node, state); break;
		case context.num: cont(node, state); break;
		case null: case undefined: write('JSValue_NUMBER(', state); cont(node, state); write(')', state); break;
		default: throw new TypeError('Unknown type: ' + typeOf(node, state));
	}
}

function write(string, state) {
	if(typeof string == 'undefined') throw new TypeError('write() called with undefined');
	if(typeof string == 'function') state.output.push(string());
	else state.output.push(string);
}

function pre(newstate, state) {
	state.pre = (state.pre || []).concat(newstate.pre || []).concat(newstate.output);
	state.post = (state.post || []).concat(newstate.post || []);
}

function post(newstate, state) {
	state.pre = (state.pre || []).concat(newstate.pre || []);
	state.post = (state.post || []).concat(newstate.output).concat(newstate.post || []);
}

function format(state) {
	return (state.pre || []).concat(state.output).concat(state.post || []).map(function(it, i, arr) {
		if(/\w/.test(it) && /\w/.test(arr[i - 1])) return ' ' + it;
		return it;
	}).join('');
}

var ids = {};
function newId(prefix) {
	return prefix + '_' + (ids[prefix] = ids[prefix] + 1 || 1);
}

walk.recursive(ast, state, {
	Program: function(node, state, cont) {
		write('int main(int argc, char *argv[]) {', state);
		node.body.forEach(function(node, i) {
			cont(node, state);
		});
		write('return 0;\n', state);
		write('}', state);
	},
	VariableDeclaration: function(node, state, cont) {
		if(state.scope == context.topScope) var newstate = {output: [], scope: state.scope};
		node.declarations.forEach(function(node, i) {
			var constant = node.init && isConstId(node.id, state);
			writeCType(typeOf(node.id, state), newstate || state, function() {
				cont(node.id, newstate || state);
			}, constant);
			if(constant) {
				write('=', newstate || state);
				writeCast(node.init, typeOf(node.id, state), newstate || state, cont);
			}
			write(';', newstate || state);
			if(node.init && !constant) {
				cont({left: node.id, right: node.init, operator: '='}, state, 'AssignmentExpression');
				write(';', state);
			}
		});
		if(state.scope == context.topScope) pre(newstate, state);
	},
	FunctionDeclaration: function(node, state, cont) {
		// forward declaration
		var newstate = {output: [], scope: node.body.scope};
		var rettype = node.body.scope.fnType.retval.getType(false);
		writeCType(rettype, newstate, function() {
			cont(node.id, newstate);
		});
		write('(', newstate);
		node.params.forEach(function(node, i) {
			if(i) write(',', newstate);
			writeCType(typeOf(node, newstate), newstate, function() {
				cont(node, newstate);
			});
		});
		write(');\n', newstate);
		pre(newstate, state);
		
		// declaration
		var newstate = {output: [], scope: node.body.scope};
		writeCType(rettype, newstate, function() {
			cont(node.id, newstate);
		});
		write('(', newstate);
		node.params.forEach(function(node, i) {
			if(i) write(',', newstate);
			writeCType(typeOf(node, newstate), newstate, function() {
				cont(node, newstate);
			});
		});
		write(')', newstate);
		cont(node.body, newstate);
		post(newstate, state);
	},
	FunctionExpression: function(node, state, cont) {
		var id = newId('_function');
		var newstate = {output: [], scope: node.body.scope};
		writeCType(typeOf(node, newstate).retval.getType(false), newstate, function() {
			write(id, newstate);
		});
		write('(', newstate);
		if(Object.prototype.hasOwnProperty.call(node.body.scope.props, 'arguments')) {
			/*writeCType(node.body.scope.props.arguments.getType(false), newstate, function() {
				write('arguments', newstate);
			});*/
		} else {
			node.params.forEach(function(node) {
				writeCType(typeOf(node, newstate), newstate, function() {
					cont(node, newstate);
				});
			});
		}
		write(')', newstate);
		cont(node.body, newstate);
		pre(newstate, state);
		write(id, state);
	},
	Identifier: function(node, state, cont) {
		write(node.name, state);
	},
	Literal: function(node, state, cont) {
		write(JSON.stringify(node.value), state);
	},
	ObjectExpression: function(node, state, cont) {
		write('(', state);
		writeCType(typeOf(node, state), state, function() {});
		write(')', state);
		write('{', state);
		node.properties.forEach(function(prop) {
			write('.', state);
			cont(prop.key, state);
			write('=', state);
			cont(prop.value, state);
			write(',', state);
		});
		write('}', state);
	},
	ArrayExpression: function(node, state, cont) {
		write('(', state);
		writeCType(typeOf(node, state), state, function() {}, false, Math.pow(2, Math.ceil(Math.log(node.elements.length) / Math.LN2)));
		write(')', state);
		write('{', state);
		var elmType = typeOf(node, state).props['<i>'].getType(false);
		node.elements.forEach(function(elm) {
			writeCast(elm, elmType, state, cont);
			write(',', state);
		});
		write('}', state);
	},
	ExpressionStatement: function(node, state, cont) {
		cont(node.expression, state);
		write(';\n', state);
	},
	AssignmentExpression: function(node, state, cont) {
		cont(node.left, state);
		write(node.operator, state);
		writeCast(node.right, typeOf(node.left, state), state, cont); // This is only between native and JSValue and should not change types
	},
	UpdateExpression: function(node, state, cont) {
		if(node.prefix) write(node.operator, state);
		cont(node.argument, state);
		if(!node.prefix) write(node.operator, state);
	},
	SequenceExpression: function(node, state, cont) {
		node.expressions.forEach(function(node, i) {
			if(i) write(', ', state);
			cont(node, state);
		});
	},
	CallExpression: function(node, state, cont) {
		cont(node.callee, state);
		write('(', state);
		var calleeType = typeOf(node.callee, state);
		node.arguments.forEach(function(node, i) {
			if(i) write(',', state);
			if(calleeType && calleeType.args && calleeType.args[i]) writeCast(node, calleeType.args[i].getType(false), state, cont);
			else cont(node, state);
		});
		write(')', state);
	},
	MemberExpression: function(node, state, cont) {
		cont(node.object, state);
		if(node.computed) write('[', state);
		else write('.', state);
		cont(node.property, state);
		if(node.computed) write(']', state);
	},
	ReturnStatement: function(node, state, cont) {
		write('return', state);
		if(node.argument) cont(node.argument, state);
		write(';\n', state);
	},
	BlockStatement: function(node, state, cont) {
		write('{\n', state);
		node.body.forEach(function(node) {
			cont(node, state);
		});
		write('}\n', state);
	},
	IfStatement: function(node, state, cont) {
		write('if (', state);
		cont(node.test, state);
		write(')', state);
		cont(node.consequent, state);
		if(node.alternate) {
			write('else', state);
			cont(node.alternate, state);
		}
	},
	WhileStatement: function(node, state, cont) {
		write('while (', state);
		cont(node.test, state);
		write(')', state);
		cont(node.body, state);
	},
	ForStatement: function(node, state, cont) {
		cont(node.init, state);
		write('; for (;', state);
		cont(node.test, state);
		write(';', state);
		cont(node.update, state);
		write(')', state);
		cont(node.body, state);
	},
	ConditionalExpression: function(node, state, cont) {
		cont(node.test, state);
		write('?', state);
		cont(node.consequent, state);
		write(':', state);
		cont(node.alternate, state);
	},
	BinaryExpression: function(node, state, cont) {
		write('(', state);
		if(node.operator == '+') {
			if(typeOf(node.left, state) == context.str || typeOf(node.right, state) == context.str) {
				if(typeOf(node.left, state) == typeOf(node.right, state)) {
					write('HPRINTF("%s%s", ', state);
					cont(node.left, state);
					write(',', state);
					cont(node.right, state);
					write(')', state);
				} else {
					write('HPRINTF("%s%s", ', state);
					writeToString(node.left, state, cont);
					write(',', state);
					writeToString(node.right, state, cont);
					write(')', state);
				}
			} else if(typeOf(node.left, state) == context.int || typeOf(node.left, state) == context.num) {
				if(typeOf(node.left, state) == typeOf(node.right, state)) {
					cont(node.left, state);
					write(node.operator, state);
					cont(node.right, state);
				} else {
					cont(node.left, state);
					write(node.operator, state);
					write('(', state);
					writeCType(typeOf(node.left, state), state, function() {});
					write(')', state);
					cont(node.right, state);
				}
			} else {
				write('HPRINTF("%s%s", ToNumber(', state);
				cont(node.left, state);
				write('), ToNumber(', state);
				cont(node.right, state);
				write('))', state);
			}
		} else if(node.operator == '%') {
			if(typeOf(node.left, state) == context.int && typeOf(node.right, state) == context.int) {
				cont(node.left, state);
				write('%', state);
				cont(node.right, state);
			} else {
				write('fmod(', state);
				cont(node.left, state);
				write(',', state);
				cont(node.right, state);
				write(')', state);
			}
		} else {
			writeCast(node.left, context.num, state, cont);
			write(node.operator, state);
			writeCast(node.right, context.num, state, cont);
		}
		write(')', state);
	},
	LogicalExpression: function(node, state, cont) {
		writeCast(node.left, context.bool, state, cont);
		write(node.operator, state);
		writeCast(node.right, context.bool, state, cont);
	},
	UnaryExpression: function(node, state, cont) {
		write(node.operator, state);
		cont(node.argument, state);
	}
}, {});

console.log('#include "' + require('path').resolve('gum.h') + '"\n' + format(state));
