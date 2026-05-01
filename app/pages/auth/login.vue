<template>
  <div class="min-h-screen flex items-center justify-center bg-background">
    <div class="w-full max-w-sm space-y-6 p-8">
      <div class="space-y-1">
        <h1 class="text-2xl font-semibold">Pixelmapper</h1>
        <p class="text-muted-foreground text-sm">Sign in to your account</p>
      </div>

      <form class="space-y-4" @submit.prevent="onSubmit">
        <div class="space-y-2">
          <Label for="email">Email</Label>
          <Input
            id="email"
            v-model="email"
            type="email"
            placeholder="you@example.com"
            autocomplete="email"
            required
          />
        </div>

        <div class="space-y-2">
          <Label for="password">Password</Label>
          <Input
            id="password"
            v-model="password"
            type="password"
            placeholder="••••••••"
            autocomplete="current-password"
            required
          />
        </div>

        <p v-if="error" class="text-sm text-destructive">{{ error }}</p>

        <Button type="submit" class="w-full" :disabled="loading">
          {{ loading ? 'Signing in…' : 'Sign in' }}
        </Button>
      </form>

      <div class="text-center space-y-2 text-sm">
        <NuxtLink to="/auth/resetPassword" class="text-muted-foreground hover:text-foreground block">
          Forgot password?
        </NuxtLink>
        <NuxtLink to="/auth/register" class="text-muted-foreground hover:text-foreground block">
          No account? <span class="text-foreground">Create one</span>
        </NuxtLink>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'

definePageMeta({ layout: false })

const supabase = useSupabaseClient()
const route = useRoute()

const email = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

async function onSubmit() {
  error.value = ''
  loading.value = true
  const { error: err } = await supabase.auth.signInWithPassword({
    email: email.value,
    password: password.value,
  })
  loading.value = false
  if (err) {
    error.value = err.message
  } else {
    const redirect = route.query.redirect as string | undefined
    await navigateTo(redirect || '/')
  }
}
</script>
