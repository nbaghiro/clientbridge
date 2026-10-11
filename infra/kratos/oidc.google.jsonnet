local claims = std.extVar('claims');
local verified = std.objectHas(claims, 'email') && std.objectHas(claims, 'email_verified') && claims.email_verified;

{
  identity: {
    traits: {
      [if verified then 'email' else null]: claims.email,
      [if std.objectHas(claims, 'name') then 'name' else null]: claims.name,
    },
    verified_addresses: if verified then [{ via: 'email', value: claims.email }] else [],
  },
}
