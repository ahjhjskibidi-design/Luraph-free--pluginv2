/**
 * AST node constructors.
 *
 * Every constructor takes only the fields that node actually needs.
 * No optional fields, no inheritance, no classes — plain objects that
 * serialize cleanly and transform predictably.
 */

import { NODE } from './types.js';

export function chunk(body) {
  return { type: NODE.CHUNK, body };
}

export function block(body) {
  return { type: NODE.BLOCK, body };
}

export function localStatement(names, values) {
  return { type: NODE.LOCAL, names, values };
}

export function assignStatement(targets, values) {
  return { type: NODE.ASSIGN, targets, values };
}

export function callStatement(expression) {
  return { type: NODE.CALL_STMT, expression };
}

export function ifStatement(clauses, elseBody) {
  return { type: NODE.IF, clauses, elseBody };
}

export function whileStatement(condition, body) {
  return { type: NODE.WHILE, condition, body };
}

export function repeatStatement(body, condition) {
  return { type: NODE.REPEAT, body, condition };
}

export function numericFor(variable, start, end, step, body) {
  return { type: NODE.FOR_NUM, variable, start, end, step, body };
}

export function genericFor(variables, iterators, body) {
  return { type: NODE.FOR_GEN, variables, iterators, body };
}

export function doStatement(body) {
  return { type: NODE.DO, body };
}

export function returnStatement(values) {
  return { type: NODE.RETURN, values };
}

export function breakStatement() {
  return { type: NODE.BREAK };
}

export function functionDeclaration(name, params, body, isLocal) {
  return {
    type: isLocal ? NODE.LOCAL_FUNC : NODE.FUNC_DECL,
    name,
    params,
    body,
  };
}

export function identifier(name) {
  return { type: NODE.IDENT, name };
}

export function stringLiteral(value) {
  return { type: NODE.STRING, value };
}

export function numberLiteral(value) {
  return { type: NODE.NUMBER, value };
}

export function boolLiteral(value) {
  return { type: NODE.BOOL, value };
}

export function nilLiteral() {
  return { type: NODE.NIL };
}

export function varargLiteral() {
  return { type: NODE.VARARG };
}

export function binaryExpression(left, operator, right) {
  return { type: NODE.BINARY, left, operator, right };
}

export function unaryExpression(operator, argument) {
  return { type: NODE.UNARY, operator, argument };
}

export function callExpression(callee, args) {
  return { type: NODE.CALL, callee, args };
}

export function methodCall(object, method, args) {
  return { type: NODE.METHOD_CALL, object, method, args };
}

export function indexExpression(object, key, computed) {
  return { type: NODE.INDEX, object, key, computed };
}

export function tableConstructor(fields) {
  return { type: NODE.TABLE, fields };
}

export function keyField(key, value) {
  return { type: NODE.FIELD_KEY, key, value };
}

export function arrayField(value) {
  return { type: NODE.FIELD_ARRAY, value };
}

export function functionExpression(params, body, isVararg) {
  return { type: NODE.FUNC_EXPR, params, body, isVararg };
}

export function parenExpression(expression) {
  return { type: NODE.PAREN, expression };
}

export default {
  chunk, block, localStatement, assignStatement, callStatement,
  ifStatement, whileStatement, repeatStatement, numericFor, genericFor,
  doStatement, returnStatement, breakStatement, functionDeclaration,
  identifier, stringLiteral, numberLiteral, boolLiteral, nilLiteral,
  varargLiteral, binaryExpression, unaryExpression, callExpression,
  methodCall, indexExpression, tableConstructor, keyField, arrayField,
  functionExpression, parenExpression,
};