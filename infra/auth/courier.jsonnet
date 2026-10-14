function(ctx)
  local data = if 'template_data' in ctx && ctx.template_data != null then ctx.template_data else {};
  local field(name) = if name in data then data[name] else null;
  local codes = std.filter(function(c) c != null, [
    field('verification_code'),
    field('recovery_code'),
    field('login_code'),
    field('registration_code'),
  ]);
  {
    template_type: ctx.template_type,
    to: ctx.recipient,
    code: if std.length(codes) > 0 then codes[0] else null,
    expires_in_minutes: field('expires_in_minutes'),
    link: field('verification_url'),
  }
