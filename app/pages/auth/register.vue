<template>
  <div class="min-h-screen flex items-center justify-center bg-background">
    <div class="w-full max-w-sm space-y-6 p-8">
      <div class="space-y-1">
        <h1 class="text-2xl font-semibold">Pixelmapper</h1>
        <p class="text-muted-foreground text-sm">Create a new account</p>
      </div>

      <form class="space-y-4" @submit.prevent="onSubmit">
        <div class="space-y-2">
          <Label for="displayName">Display name</Label>
          <Input
            id="displayName"
            v-model="displayName"
            type="text"
            placeholder="Your name"
            autocomplete="name"
            required
          />
        </div>

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
            autocomplete="new-password"
            required
          />
        </div>

        <p v-if="error" class="text-sm text-destructive">{{ error }}</p>
        <p v-if="success" class="text-sm text-green-500">{{ success }}</p>

        <Button type="submit" class="w-full" :disabled="loading">
          {{ loading ? 'Creating account…' : 'Create account' }}
        </Button>
      </form>

      <div class="text-center text-sm">
        <NuxtLink to="/auth/login" class="text-muted-foreground hover:text-foreground">
          Already have an account? <span class="text-foreground">Sign in</span>
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

const displayName = ref('')
const email = ref('')
const password = ref('')
const error = ref('')
const success = ref('')
const loading = ref(false)

async function onSubmit() {
  error.value = ''
  success.value = ''
  loading.value = true
  const { error: err } = await supabase.auth.signUp({
    email: email.value,
    password: password.value,
    options: {
      data: { display_name: displayName.value },
    },
  })
  loading.value = false
  if (err) {
    error.value = err.message
  } else {
    success.value = 'Check your email to confirm your account.'
  }
}
</script>
