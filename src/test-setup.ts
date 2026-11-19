import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(cleanup)

import { beforeEach } from 'vitest'
import { forgetAll } from './lib/remember'
beforeEach(() => forgetAll())
