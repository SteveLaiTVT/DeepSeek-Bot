// Plain helpers for the Create Bot form, kept free of React so tests can load them.

// What the form sends. The name, model, and introduction are the host's to check: the
// form shows what the team state suggests (`state.defaults`) and passes it on as it is.
export function createPayload({ name, look, image, model, effort, brief, intro, capabilities }) {
  const payload = { name, color: look.color, avatar: image ? { shape: look.shape, image } : { shape: look.shape } }
  if (model) payload.model = model
  if (effort) payload.effort = effort
  if (brief) payload.brief = brief
  if (intro) payload.intro = String(intro).trim()
  if (capabilities) payload.capabilities = capabilities
  return payload
}
