import { describe, expect, it } from 'vitest'
import { aiDishFields, aiRecipeIngredients, parseAmount } from './ai-dish'
import type { AiRecipe } from '../sync/ai'

describe('parseAmount', () => {
  it('reads a number and one of the app units', () => {
    expect(parseAmount('400 גרם')).toEqual({ quantity: 400, unit: 'גרם' })
    expect(parseAmount('1.5 כוסות')).toEqual({ quantity: 1.5, unit: 'כוס' })
    expect(parseAmount('2 כפות')).toEqual({ quantity: 2, unit: 'כף' })
    expect(parseAmount('1 כפית')).toEqual({ quantity: 1, unit: 'כפית' })
    expect(parseAmount('1 ק"ג')).toEqual({ quantity: 1, unit: 'ק"ג' })
    expect(parseAmount('250 מ״ל')).toEqual({ quantity: 250, unit: 'מ"ל' })
    expect(parseAmount('3 יחידות')).toEqual({ quantity: 3, unit: "יח'" })
  })

  it('handles fractions, mixed numbers and ranges', () => {
    expect(parseAmount('½ כפית')).toEqual({ quantity: 0.5, unit: 'כפית' })
    expect(parseAmount('1 ½ כוס')).toEqual({ quantity: 1.5, unit: 'כוס' })
    expect(parseAmount('1/2 כפית')).toEqual({ quantity: 0.5, unit: 'כפית' })
    expect(parseAmount('2-3 יחידות')).toEqual({ quantity: 2, unit: "יח'" })
  })

  it('keeps only the first amount when a conversion follows in brackets', () => {
    expect(parseAmount('1 כוס (200 גרם)')).toEqual({ quantity: 1, unit: 'כוס' })
  })

  it('gives up on units the app has no word for', () => {
    expect(parseAmount('2 שיני')).toEqual({ quantity: null, unit: null })
    expect(parseAmount('לפי הטעם')).toEqual({ quantity: null, unit: null })
    expect(parseAmount('')).toEqual({ quantity: null, unit: null })
  })
})

const recipe: AiRecipe = {
  servings: 2,
  prep_time_minutes: 45,
  ingredients: [
    { name: 'חזה עוף', amount: '400 גרם' },
    { name: 'אורז', amount: '1 כוס (200 גרם)' },
    { name: 'שום', amount: '2 שיני' },
    { name: 'מלח', amount: '1 כפית' },
    { name: 'לימון', amount: '1 יחידה' },
  ],
  steps: ['לחמם תנור', 'לאפות'],
  tips: [],
}

describe('aiRecipeIngredients', () => {
  it('marks the fridge items as mains, at most two', () => {
    const ings = aiRecipeIngredients(recipe, ['עוף', 'אורז', 'לימון'])
    expect(ings.filter((i) => i.is_main).map((i) => i.name)).toEqual(['חזה עוף', 'אורז'])
  })

  it('falls back to the first ingredient when nothing matches the fridge', () => {
    const ings = aiRecipeIngredients(recipe, ['טופו'])
    expect(ings.filter((i) => i.is_main).map((i) => i.name)).toEqual(['חזה עוף'])
  })

  it('keeps an amount it cannot convert readable in the name', () => {
    const garlic = aiRecipeIngredients(recipe, ['עוף']).find((i) => i.name.startsWith('שום'))
    expect(garlic).toMatchObject({ name: 'שום (2 שיני)', quantity: null, unit: null })
  })

  it('does not scale salt with the number of diners', () => {
    const ings = aiRecipeIngredients(recipe, ['עוף'])
    expect(ings.find((i) => i.name === 'מלח')?.is_scalable).toBe(false)
    expect(ings.find((i) => i.name === 'חזה עוף')?.is_scalable).toBe(true)
  })
})

describe('aiDishFields', () => {
  it('carries over name, time, servings and the recipe', () => {
    const fields = aiDishFields(
      { name: ' עוף בתנור עם אורז ', instructions: '', ingredients: [] },
      recipe,
      ['עוף'],
    )
    expect(fields).toMatchObject({
      name: 'עוף בתנור עם אורז',
      prep_time_minutes: 45,
      base_servings: 2,
      recipe: { steps: ['לחמם תנור', 'לאפות'], tips: [] },
    })
  })
})
