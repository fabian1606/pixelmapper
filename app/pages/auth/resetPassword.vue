<template>
  <div class="min-h-screen flex items-center justify-center bg-background">
    <div class="w-full max-w-sm space-y-6 p-8">
      <div class="space-y-1">
        <h1 class="text-2xl font-semibold">Reset password</h1>
        <p class="text-muted-foreground text-sm">We'll send you a reset link</p>
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

        <p v-if="error" class="text-sm text-destructive">{{ error }}</p>
        <p v-if="success" class="text-sm text-green-500">{{ success }}</p>

        <Button type="submit" class="w-full" :disabled="loading">
          {{ loading ? 'Sending…' : 'Send reset link' }}
        </Button>
      </form>

      <div class="text-center text-sm">
        <NuxtLink to="/auth/login" class="text-muted-foreground hover:text-foreground">
          Back to sign in
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

const email = ref('')
const error = ref('')
const success = ref('')
const loading = ref(false)

async function onSubmit() {
  error.value = ''
  success.value = ''
  loading.value = true
  const { error: err } = await supabase.auth.resetPasswordForEmail(email.value, {
    redirectTo: `${window.location.origin}/auth/confirm`,
  })
  loading.value = false
  if (err) {
    error.value = err.message
  } else {
    success.value = 'Check your email for the reset link.'
  }
}
</script>
