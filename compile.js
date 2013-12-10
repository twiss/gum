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
		if(type == context.num && node.type == 'Identifier') {
			var name = node.name;
			if(!state.scope.fnType || state.scope.fnType.argNames.indexOf(name) == -1) {
				node.typeOf = context.int;
				var NotAnInt = {};
				try {
					walk.recursive(state.scope.node, null, {
						AssignmentExpression: function(node) {
							if(node.left.name == name && typeOf(node.right, state) != context.int) throw NotAnInt;
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

function writeCType(type, state, writeid) {
	if(!type) {
		write('JSValue', state);
		writeid();
		return;
	}
	/*if(type.proto == context.protos.Array) {
		writeCType(type.props['<i>'].getType(false), state, function() {
			write('*', state);
			writeid();
		});
		return;
	}*/
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
		write('struct {', state);
		Object.getOwnPropertyNames(type.props).forEach(function(prop) {
			writeCType(type.props[prop].getType(false), state, function() {
				write(prop, state);
			});
			write(';\n', state);
		});
		write('}', state);
	} else {
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

function writeCast(node, toType, state, cont) {
	var fromType = typeOf(node, state);
	switch(toType) {
		case context.str: writeToString(node, state, cont); break;
		case context.num: writeToValue(node, state, cont); break;
		case null: case undefined:
			switch(fromType) {
				case context.str: write('JSSTRING(', state); 
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
		write('int main() {', state);
		node.body.forEach(function(node, i) {
			cont(node, state);
		});
		write('return 0;\n', state);
		write('}', state);
	},
	VariableDeclaration: function(node, state, cont) {
		if(state.scope == context.topScope) var newstate = {output: [], scope: state.scope};
		node.declarations.forEach(function(node, i) {
			cont(node, newstate || state);
			write(';', newstate || state);
		});
		if(state.scope == context.topScope) pre(newstate, state);
	},
	VariableDeclarator: function(node, state, cont) {
		writeCType(typeOf(node.id, state), state, function() {
			cont(node.id, state);
		});
		if(node.init) {
			write('=', state);
			cont(node.init, state);
		}
	},
	FunctionDeclaration: function(node, state, cont) {
		// forward declaration
		var newstate = {output: [], scope: node.body.scope};
		writeCType(typeOf(node.id, newstate), newstate, function() {
			cont(node.id, newstate);
		});
		write('(', newstate);
		node.params.forEach(function(node) {
			writeCType(typeOf(node, newstate), newstate, function() {
				cont(node, newstate);
			});
		});
		write(');\n', newstate);
		pre(newstate, state);
		
		// declaration
		var newstate = {output: [], scope: node.body.scope};
		writeCType(typeOf(node.id, newstate), newstate, function() {
			cont(node.id, newstate);
		});
		write('(', newstate);
		node.params.forEach(function(node) {
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
	ExpressionStatement: function(node, state, cont) {
		cont(node.expression, state);
		write(';\n', state);
	},
	AssignmentExpression: function(node, state, cont) {
		cont(node.left, state);
		write(node.operator, state);
		cont(node.right, state);
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
			if(calleeType && calleeType.args) writeCast(node, calleeType.args[i].getType(false), state, cont);
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
			cont(node.left, state);
			write(node.operator, state);
			cont(node.right, state);
		}
	},
	UnaryExpression: function(node, state, cont) {
		write(node.operator, state);
		cont(node.argument, state);
	}
}, {});

console.log('#include "' + require('path').resolve('gum.h') + '"\n' + format(state));