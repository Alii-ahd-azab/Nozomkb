# Nozom Knowledge Bank

## Goal

Build an internal knowledge platform where Nozom employees can find trusted company information, share useful experience, and later ask an AI assistant questions based on available company knowledge.

## Users

- Member: reads knowledge and contributes personal posts.
- Editor: manages and publishes official company content.
- Admin: manages access and broader platform settings.

## Initial Scope

For the first version, the platform will focus on:
- Company information and policies
- Employee posts and shared knowledge
- Search
- Basic content organization
- Later, AI-powered answers with sources

## User Stories

1. As a Member, I want to search for the procedure for requesting paid sick leave, so that I can quickly understand what I need to do when I am sick.

2. As a Member, I want to find the procedure for submitting a deliverable to my team leader, so that I can submit my work correctly before the deadline.

3. As a Member, I want to make a post about a useful trick I learned in accounting, so that my colleagues can benefit from it.

4. As an Editor, I want to update the Notice Period Policy from 3 weeks to 2 weeks, so that employees see the latest approved company policy.

5. As an Admin, I want to remove inappropriate comments, so that discussions remain professional and relevant.

6. As an Admin, I want to revoke a user's access when they leave the company, so that former employees can no longer access internal knowledge.

## Day 1 Status

Completed:
- Development environment prepared
- Next.js application created
- TypeScript and ESLint configured
- Local development server tested
- Initial About page created
- Basic responsive styling added
- Project goal, users, scope, and User Stories documented

Not implemented yet:
- Persistent data
- Authentication
- Search functionality
- Posts functionality
- Database
- AI Chat



## Day 2 Status

Completed:
- Reviewed and modified the existing About page
- Practiced basic HTML/JSX structure
- Practiced CSS styling and layout
- Used CSS variables for the Nozom color theme
- Worked with Variables and Objects in the current page
- Improved spacing, typography, responsiveness, and visual hierarchy
- Added responsive behavior for smaller screens

Day 2 output:
- About page is readable and presentable
- Page structure and styling can be explained
- Basic HTML, CSS, Variables, and Objects are understood in context



## Day 3 Status

Completed:
- Created a reusable `PostCard` component
- Created a Feed using 5 sample Posts
- Added a `Post` Type
- Created an Array of Post objects
- Used `map()` to render PostCards from the Posts array
- Passed Post data into components using Props
- Added Post tags to each card
- Added a reusable Feed section
- Added a post count function
- Practiced tracing data from the Posts array to the rendered UI

Day 3 output:
- Feed displays 5 sample Posts
- Post data can be traced from the Array to the PostCard component
- Components, Props, Types, Arrays, Objects, and `map()` can be explained



## Day 4 Status

Completed:
- Created a reusable Layout component
- Created a separate Knowledge Feed page at `/feed`
- Moved shared Post data into `data/posts.ts`
- Created dynamic Post Details routes using `/posts/[id]`
- Connected each PostCard to its corresponding details page
- Added handling for invalid Post IDs
- Added navigation between About, Knowledge Feed, and Post Details
- Added a reusable Toolbar component
- Added Nozom branding and logo to the toolbar
- Made the Nozom logo and brand link back to the About page
- Added responsive toolbar behavior
- Added a Back to Top button
- Verified all 5 sample Posts open the correct detail pages

Day 4 output:
- Navigation works
- Sample content is clear
- Each Post opens its correct details page
- Layout and Components are organized