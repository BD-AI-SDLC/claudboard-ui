import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import BrandMark from './BrandMark.js'

afterEach(() => { cleanup() })

describe('BrandMark', () => {
  it('renders with default size 20 and default variant', () => {
    const { container } = render(<BrandMark />)
    const wrapper = container.firstElementChild as HTMLElement
    expect(wrapper).toBeTruthy()
    expect(wrapper.style.width).toBe('20px')
    expect(wrapper.style.height).toBe('20px')
  })

  it('renders with a custom size prop', () => {
    const { container } = render(<BrandMark size={40} />)
    const wrapper = container.firstElementChild as HTMLElement
    expect(wrapper.style.width).toBe('40px')
    expect(wrapper.style.height).toBe('40px')
  })

  it('default variant produces wrapper class brand-mark only (no inverted modifier)', () => {
    const { container } = render(<BrandMark />)
    const wrapper = container.firstElementChild as HTMLElement
    expect(wrapper.className).toContain('brand-mark')
    expect(wrapper.className).not.toContain('brand-mark--inverted')
  })

  it('inverted variant adds brand-mark--inverted class', () => {
    const { container } = render(<BrandMark variant="inverted" />)
    const wrapper = container.firstElementChild as HTMLElement
    expect(wrapper.className).toContain('brand-mark--inverted')
  })

  it('SVG contains exactly two rect elements with the documented coordinates', () => {
    const { container } = render(<BrandMark />)
    const rects = Array.from(container.querySelectorAll('rect'))
    expect(rects).toHaveLength(2)
    // ghost cell
    expect(rects[0]?.getAttribute('x')).toBe('12')
    expect(rects[0]?.getAttribute('y')).toBe('5')
    // primary cell
    expect(rects[1]?.getAttribute('x')).toBe('5')
    expect(rects[1]?.getAttribute('y')).toBe('12')
  })

  it('appends className prop to the wrapper', () => {
    const { container } = render(<BrandMark className="my-extra" />)
    const wrapper = container.firstElementChild as HTMLElement
    expect(wrapper.className).toContain('my-extra')
  })
})
