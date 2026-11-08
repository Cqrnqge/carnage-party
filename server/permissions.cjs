'use strict';

const { PERMISSIONS } = require('./constants.cjs');

const ALL_PERMISSIONS = PERMISSIONS.map((p) => p.key);

function getMember(server, userId) {
  return server.members.find((m) => m.userId === userId) || null;
}

function isMember(server, userId) {
  return Boolean(getMember(server, userId));
}

function roleMap(server) {
  const map = new Map();
  for (const role of server.roles || []) map.set(role.id, role);
  return map;
}

function permissionsOf(server, userId) {
  if (!server) return [];
  if (server.ownerId === userId) return [...ALL_PERMISSIONS];
  const member = getMember(server, userId);
  if (!member) return [];
  const roles = roleMap(server);
  const set = new Set();
  for (const roleId of member.roleIds || []) {
    const role = roles.get(roleId);
    if (!role) continue;
    for (const perm of role.permissions || []) set.add(perm);
  }
  const everyone = (server.roles || []).find((r) => r.id === `${server.id}_everyone`) || (server.roles || []).find((r) => r.system);
  if (everyone) {
    for (const perm of everyone.permissions || []) set.add(perm);
  }
  if (set.has('ADMINISTRATOR')) return [...ALL_PERMISSIONS];
  return [...set];
}

function hasPermission(server, userId, permission) {
  if (!server) return false;
  if (server.ownerId === userId) return true;
  const perms = permissionsOf(server, userId);
  return perms.includes('ADMINISTRATOR') || perms.includes(permission);
}

function isHigherOrOwner(server, actorId, targetId) {
  if (server.ownerId === actorId) return true;
  if (server.ownerId === targetId) return false;
  const actor = getMember(server, actorId);
  const target = getMember(server, targetId);
  if (!actor || !target) return false;
  const roles = roleMap(server);
  const actorMax = Math.max(0, ...(actor.roleIds || []).map((id) => roles.get(id)?.position || 0));
  const targetMax = Math.max(0, ...(target.roleIds || []).map((id) => roles.get(id)?.position || 0));
  return actorMax > targetMax;
}

module.exports = {
  ALL_PERMISSIONS,
  getMember,
  isMember,
  permissionsOf,
  hasPermission,
  isHigherOrOwner,
};
