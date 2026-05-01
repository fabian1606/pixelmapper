<template>
  <div class="min-h-screen flex items-center justify-center bg-background">
    <div class="w-full max-w-sm space-y-4 p-8 text-center">
      <p v-if="loading" class="text-muted-foreground">Confirming…</p>
      <p v-else-if="error" class="text-destructive text-sm">{{ error }}</p>
      <p v-else class="text-sm text-muted-foreground">Redirecting…</p>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: false })

const supabase = useSupabaseClient()
const router = useRouter()

const loading = ref(true)
const error = ref('')

onMounted(async () => {
  // @nuxtjs/supabase handles the token exchange automatically via the callback route.
  // This page is shown briefly while the session is being established.
  const { data, error: err } = await supabase.auth.getSession()
  loading.value = false
  if (err || !data.session) {
    error.value = err?.message ?? 'Authentication failed. Please try again.'
  } else {
    router.push('/')
  }
})
</script>
