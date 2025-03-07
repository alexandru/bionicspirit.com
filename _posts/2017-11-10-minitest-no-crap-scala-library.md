---
title: "Minitest: Zero Crap Scala Testing Library"
clean_summary:
  Provides only the minimal functionality needed, with ScalaCheck integration and maximum compatibility.
tags:
  - Testing
  - Scala
image: /assets/media/articles/scala.png
generate_toc: true
---

<p class="intro" markdown='1'>[Minitest](https://github.com/monix/minitest) is my minimal testing library that I've been using for developing [Monix](https://monix.io).</p>

## Raison d'être

I dislike most testing frameworks, because of bloat and of heavy DSLs
trying to mimic the English language. When I created Minitest, I
wasn't satisfied with any of the available alternatives.

Then I found that [SBT](http://www.scala-sbt.org/) can do all the
heavy lifting (e.g. running the tests, reporting, etc), exposing a
nice [sbt/test-interface](https://github.com/sbt/test-interface) that
you can integrate with. All you need to do is to build your own
API on top. And so I did.

<p class='info-bubble' markdown='1'>
**NOTE:** My opinions in this article disagree with the design
choices of popular testing libraries. I know that libraries like
[ScalaTest](http://www.scalatest.org/) or
[Specs2](https://etorreborre.github.io/specs2/) are the way they
are because people want them that way. And those are awesome
projects, having awesome authors. They are just not for me.
</p>

### Portability

The natural tendency of testing frameworks is to grow beyond all
imagination in order to accommodate the various testing styles that
people want, these testing frameworks also end up hard to port to new
platforms - which is especially relevant in Scala due to new major
versions and new targets released all the time
(e.g. [Scala.js](http://www.scala-js.org/), [Scala
Native](https://github.com/scala-native/scala-native),
[Dotty](https://github.com/lampepfl/dotty)).

In 2014 I started to work on [Monix](https://monix.io) and during that
time [Scala.js](http://www.scala-js.org/) was also born.

This awesome Scala compiler that targets JavaScript was really fresh
back then and I wanted to target it, however none of the testing
libraries (e.g. [ScalaTest](http://www.scalatest.org/)) were
supporting it yet, except for
[µTest](https://github.com/lihaoyi/utest). µTest seemed fine, but it
had problems when displaying error messages, plus its DSL was and
still is weird.

For some reason I don't like magic in my tests — and by magic I mean
expressions or statements that I don't immediately understand. That,
and I wanted an easy transition in Monix from ScalaTest's
[FunSuite](http://www.scalatest.org/getting_started_with_fun_suite),
which is what I was using.

### Say No to DSLs

I do not want to write `x shouldBe greaterThan(y)` or other such
nonsense. I do not have the memory for that, I always forget the API
and the IDE doesn't help much due to the implicit conversions going on.

Unit tests might be business driven, but so is software in
general, nothing makes tests a special snowflake to warrant the abuse
of the programming language to make it look like English.

Yes, there are advantages to such a DSL. For example if you express
the above with a simple `assert`, then you won't get a meaningful
error message back, depending on whether the implementation does or
doesn't do macros for `assert`, but if it does, then that's a whole
other can of worms:

```scala
assert(x > y)
```

**Fact:** most assertions that you need to do in testing are *equality
tests* and for that rare moment in which you need inequality tests, you
can simply add a custom error message:

```scala
assert(x > y, s"$x > $y")
```

Yes, it's repetitive, but I don't care, because this is such a rare
event that I don't want to optimize it with a special DSL or even with
macros.

Another thing that I absolutely hate are tests marked with English
words like "`it`", forcing you to phrase the test's description in a
certain way. I frequently end up with "sentences" that makes no sense:

```scala
it("left identity") {
  // ...
}
```

This tendency actually stems from Java OOP, with its "kingdom of
nouns", the idea being that the things you're testing are all nouns
that interact with the world, aka objects. Well, I'm not testing just
objects, so `it` is a bad trend.

And the idea that business folks might be writing tests, hell no, that
almost never happens and if they are inclined to do that (like once in
a million), then they can just learn programming. It's not like an
English-like DSL is any closer to natural language.

### Minimal Implementation, Less is More

Because the implementation is minimal, there's nothing that I can't
fix in it, there's nothing that I can't implement should I need
anything.

It's also easy to port to new targets. I intend to port it to
[Scala Native](https://github.com/scala-native/scala-native) as soon as it
is available for Scala 2.12 (at the moment of writing, it isn't).

In fact, if you want to build your own testing framework, Minitest can
serve as a sample ;-)

## Hypothesis

All you need is the ability to express:

1. synchronous tests, returning `Unit` (or an equivalent, as I ended
   up doing in order to avoid Scala's annoying implicit conversion)
2. asynchronous tests, returning `Future`
3. the ability to setup an environment before every test, then
   tear it down after each test

All the asserts that you need:

1. `assert(boolean, string?)`: general purpose assertion for any
   condition
2. `assertEquals(received, expected)`: for equality testing with a
   nice error message
3. `intercept`: for testing that exceptions are thrown
4. `fail(reason?)`: fails the current test
5. `ignore(reason?)`: ignores the current test
6. `cancel(reason?)`: cancels the current test

What you don't need:

1. nesting in tests
2. an English-like DSL
3. a purely functional *base* API

## Tutorial

Test suites MUST BE objects, not classes. To create a simple test
suite, it could inherit from `SimpleTestSuite`. Here's a simple test:

```scala
import minitest.SimpleTestSuite

object MySimpleSuite extends SimpleTestSuite {
  test("should be") {
    assertEquals(2, 1 + 1)
  }

  test("should not be") {
    assert(1 + 1 != 3)
  }

  test("should throw") {
    class DummyException extends RuntimeException("DUMMY")
    def test(): String = throw new DummyException

    intercept[DummyException] {
      test()
    }
  }

  test("test result of") {
    assertResult("hello world") {
      "hello" + " " + "world"
    }
  }

  test("should be ignored") {
    if (Platform.isJS) ignore("Blocking not supported on top of JS")
    val r = Await.result(Future(1), Duration.Inf)
    assertEquals(r, 1)
  }
}
```

In case you want to setup an environment for each test and need
`setup` and `tearDown` semantics, you could inherit from
[TestSuite](https://github.com/monix/minitest/blob/v2.0.0/shared/src/main/scala/minitest/TestSuite.scala).
Then on each `test` definition, you'll receive a fresh value:

```scala
import monix.execution.schedulers.TestScheduler
import minitest.TestSuite

object MyTestSuite extends TestSuite[TestScheduler] {
  def setup() = TestScheduler()

  def tearDown(env: TestScheduler): Unit =
    assert(env.state.tasks.isEmpty, "Scheduler should not have tasks left")

  test("simulated async") { implicit ec =>
    val f = Future(1).map(_ + 1)
    ec.tick()

    assertEquals(f.value, Some(Success(2)))
  }
}
```

Minitest supports asynchronous results in tests, just use `testAsync`
and return a `Future[Unit]`:

```scala
import scala.concurrent.ExecutionContext.Implicits.global

object MySimpleSuite extends SimpleTestSuite {
  testAsync("asynchronous execution") {
    val future = Future(100).map(_+1)

    for (result <- future) yield {
      assertEquals(result, 101)
    }
  }
}
```

Minitest has integration with
[ScalaCheck](https://www.scalacheck.org/).
So for property-based testing:

```scala
import minitest.laws.Checkers

object MyLawsTest extends SimpleTestSuite with Checkers {
  test("addition of integers is commutative") {
    check2((x: Int, y: Int) => x + y == y + x)
  }

  test("addition of integers is transitive") {
    check3((x: Int, y: Int, z: Int) => (x + y) + z == x + (y + z))
  }
}
```

That's everything!

## Common Complaints

### I do not like Future

That's too bad, because the `Future` is needed by the runtime and
regardless what alternative you use (e.g. `cats.effect.IO`,
`monix.eval.Task`), you'll have to convert it into a `Future` anyway.

Besides, a good testing framework cannot have dependencies, because it
would end in conflict with the project's dependencies. It's unwise to
depend on Cats or Scalaz.

And you can always build your own `testTask`, `testEffect` or `testIO`
utilities on top of `testAsync`.

### I want a purely functional API

[Specs2](https://etorreborre.github.io/specs2/) has a nice functional
API. You might like that, however I don't like it for all the reasons
stated above.

And if pure FP is what you want, nothing stops you from implementing
your own utilities and I recommend piggybacking on ScalaCheck, e.g:

```scala
import cats.effect.IO
import org.scalacheck.{Prop, Test}
import scala.concurrent.ExecutionContext.Implicits.global

trait PureTestSuite extends minitest.api.AbstractTestSuite {
  private[this] val ts = new SimpleTestSuite {}
  lazy val properties = ts.properties

  def test(name: String)(f: => Prop): Unit =
    ts.test(name) {
      val result = Test.check(config, f)
      if (!result.passed) fail(Pretty.pretty(result))
    }

  def testIO(name: String)(f: => IO[Prop]): Unit =
    ts.testAsync(name) {
      f.unsafeToFuture.map { result =>
        val result = Test.check(config, f)
        if (!result.passed) fail(Pretty.pretty(result))
      }
    }
}
```

There's your purely functional API in just a couple of lines of code.

I don't want that in Monix though - the integration that we have with
ScalaCheck is minimal and enough.

### It does not support Maven, CBT or others

Sorry about that, but this library is meant to be minimal and stable,
and I don't have the time to expand support beyond SBT right now.

Pull requests open and only accepted if they don't complicate the
codebase much.

## Final Words

Forget DSLs.

All you need for testing are
[Minitest](https://github.com/monix/minitest/) and
[ScalaCheck](https://www.scalacheck.org/).
