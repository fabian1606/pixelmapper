export default defineNuxtRouteMiddleware(async (to, from) => {
  const supabase = useSupabaseClient()

  // getUser() validates server-side; getSession() only reads localStorage and can return stale/invalid sessions
  const { data: { user } } = await supabase.auth.getUser()

  if (user && to.path.startsWith('/auth/')) {
    return navigateTo('/')
  }

  if (!user && to.path.startsWith('/project/')) {
    return navigateTo(`/auth/login?redirect=${encodeURIComponent(to.fullPath)}`)
  }
})
