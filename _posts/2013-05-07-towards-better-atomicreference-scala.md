---
title: "Towards a Better AtomicReference"
tags:
  - Languages
  - FP
  - Scala
  - Java
  - Multithreading
  - Concurrency
---

<p class="intro" markdown='1'>
  The
  [AtomicReference](http://docs.oracle.com/javase/6/docs/api/java/util/concurrent/atomic/package-summary.html)
  is like a container for a `volatile` reference. Usage of `volatile`
  references is useful for the issue of
  [visibility](/blog/2013/03/14/jvm-multithreading-monitor-locks-visibility.html#visibility)
  in concurrent code, however `AtomicReference` also supports the atomic
  [Compare-and-Swap](http://en.wikipedia.org/wiki/Compare-and-swap)
  operation (CAS for short), which is the pillar of all non-blocking
  data-structures and algorithms built on top of the JVM, including
  complex ones like the `ConcurrentLinkedQueue`, an implementation based
  on the
  [Michael-Scott non-blocking queues](http://www.cs.rochester.edu/u/michael/PODC96.html).
</p>

However, the interface provided leaves something to be desired:

* the [compareAndSet](http://docs.oracle.com/javase/6/docs/api/java/util/concurrent/atomic/AtomicReference.html#compareAndSet%28V,%20V%29)
  operation is too low level and for 99% of everything we do in our day to day
  code it can be replaced with something much better, as we'll see
* the classes from the `java.util.concurrent.atomic` package do not
  implement a common interface, so you can't use an
  [AtomicInteger](http://docs.oracle.com/javase/6/docs/api/java/util/concurrent/atomic/AtomicInteger.html)
  in place of an `AtomicReference`
* `AtomicInteger` and `AtomicLong` provide `incrementAndGet`, which is
  really useful in practice for keeping track of things in
  non-blocking counters, but why should that be available only for
  Ints and Longs?  Floats, Doubles, BigInt, BigDecimal and all kinds
  of numbers can be incremented too

**IMPORTANT UPDATE (March 31, 2014):** The content of this article is slightly obsolete, though
still has pedagogical value. For an up to date article on my Atomic references, checkout the wiki page maintained for project [Monifu](https://github.com/alexandru/monifu/): [Atomic References](https://github.com/alexandru/monifu/blob/master/docs/atomic.md)

<!-- read more -->

This is a simple and working example of how Scala can improve your
code tremendously. And I'm basically describing the implementation of
my own `shifter.concurrency.atomic.Ref`. You can:

* see the code in [my GitHub repo](https://github.com/alexandru/shifter/blob/master/core/src/main/scala/shifter/concurrency/atomic/Ref.scala)
* checkout the [API docs](http://shifter.alexn.org/api/current/core/#shifter.concurrency.atomic.package)

## The Common Interface

Lets start by mirroring the basics of AtomicReference:

```scala
trait Ref[T] {
  def get: T
  def set(update: T)
  def compareAndSet(expect: T, update: T): Boolean
}

object Ref {
  def apply[T](initial: T) = new RefAny(initial)
}
```

With a generic implementation that for now just delegates to our inner
`AtomicReference`:

```scala
class RefAny[T](initial: T) extends Ref[T] {
  def get =
    instance.get()
  def set(update: T) =
    instance.set(update)
  def compareAndSet(expect: T, update: T) =
    instance.compareAndSet(expect, update)

  private[this] val instance = new AtomicReference(initial)
}
```

As I was saying, the `compareAndSet` is too low level. Much better is
to work with transformations. How about defining a function with the
following signature:

```scala
def transformAndGet(cb: T => T): T
```

And that can be used like this:

```scala
val ref = Ref(2)

ref.transformAndGet(x => x + 2)
// => 4
```

Well, incrementing numbers is not the only thing that you can do. For
instance you could store and transform immutable data-structures, like a queue:

```scala
import collection.immutable.Queue

val ref = Ref(Queue.empty[String])

ref.transformAndGet(q => q.enqueue("Alex"))
```

How about that? We got ourselves a non-blocking queue, without having
to implement the dreadful Michael-Scott algorithm.

Implementing `Ref.transformAndGet` is easy:

```scala
  @tailrec
  final def transformAndGet(cb: T => T): T = {
    val oldValue = get
    val newValue = cb(oldValue)

    if (!compareAndSet(oldValue, newValue))
	  // tail-recursive call
      transformAndGet(cb)
    else
      newValue
  }
```

I'm using a tail-recursive function, guarded by the `tailrec`
annotation, because that's how I roll. I also find it much more
readable and less error-prone. It creates a loop ... as long as the
`compareAndSet` operation is unsuccessful, then it keeps trying.

We can also implement `Ref.getAndTransform`, which returns the old
value before the transformation occurred, instead of the update:

```scala
  @tailrec
  final def getAndTransform(cb: T => T): T = {
    val oldValue = get
    val update = cb(oldValue)

    if (!compareAndSet(oldValue, update))
	  // tail-recursive call
      getAndTransform(cb)
    else
      oldValue
  }
```

We can have other utilities too, like
[transformAndExtract](http://shifter.alexn.org/api/current/core/index.html#shifter.concurrency.atomic.Ref@transformAndExtract[U]%28cb:T=%3E%28T,U%29%29:U),
but lets move on to our next issue ... incrementing numbers.

Of course, with our transformation functions, the presence of a
shortcut for incrementing numbers is not that required anymore,
however it's still a nice shortcut that can also provide readability
and performance advantages. The problem with a generic
`AtomicReference` is that not all reference types are numbers that can
be incremented. Fortunately for us, Scala gives us
[Type Classes](http://en.wikipedia.org/wiki/Type_class) and there is
already a type class defined in Scala's standard library for numbers:
[Numeric[T]](http://www.scala-lang.org/api/current/index.html#scala.math.Numeric).

What `Numeric[T]` does is to define, amongst others, the `sum`
operation for type `T` and of course the value for `one`. And we don't
need more than that.

So we can define our `Ref.incrementAndGet` function, in a generic way,
like this:

```scala
  def incrementAndGet(implicit num : Numeric[T]) =
    transformAndGet(x => num.plus(x, num.one))
```

And lo and behold, this stuff works for any kind of number, not just
Ints and Longs:

```scala
scala> val ref = Ref(BigInt(1))
ref: Ref[scala.math.BigInt] = Ref(1)

scala> ref.incrementAndGet
res0: scala.math.BigInt = 2
```

Best of all, if we try doing this on things that aren't numbers, then
it fails with a compile-time error:

```scala
scala> val ref = Ref("hello")
ref: Ref[String] = Ref(hello)

scala> ref.incrementAndGet
<console>:9: error: could not find implicit value for parameter num: Numeric[String]
              ref.incrementAndGet
                  ^
```

`AtomicInteger` from Java's standard library already has an
`incrementAndGet` and who knows, it might be more efficient than our
implementation. Maybe at some point it will get translated into a
single processor instruction. So we can take advantage of that by
specializing our `Ref` for `Int`:

```scala
final class RefInt(initialValue: Int) extends Ref[Int] {
  // ....

  override def incrementAndGet(implicit num: Numeric[Int]): Int =
    instance.incrementAndGet()

  private[this] val instance = new AtomicInteger(initialValue)
}

```

And then we can make our primary constructor return a `RefInt`, in
case the initial value is an `Int`. Well, here's how the code in
`shifter.concurrency.atomic.Ref` looks like:

```scala
object Ref {
  def apply(initialValue: Int): RefInt =
    new RefInt(initialValue)

  def apply(initialValue: Long): RefLong =
    new RefLong(initialValue)

  def apply(initialValue: Boolean): RefBoolean =
    new RefBoolean(initialValue)

  def apply[T](initialValue: T): Ref[T] =
    new RefAny[T](initialValue)
}
```

There is still one difference between a `Ref[Int]` and
`AtomicInteger`. Our interface will be guilty of
[boxing and unboxing](http://en.wikipedia.org/wiki/Object_type_%28object-oriented_programming%29#Boxing)
the integers passed to those functions. And in the wild, using
`AtomicInteger` for cheap and non-blocking counters is really common,
so it's a pitty if we'll have performance degradation here.

The fix is easy though. The Scala compiler can specialize our type T
for primitive types, if we annotate our type like this:

```scala
trait Ref[@specialized(scala.Int, scala.Long, scala.Boolean) T] {
  // ...
}
```

In the example, the compiler will specialize the `Ref[T]` interface
for Ints, Longs and Booleans, to avoid the boxing and unboxing
overhead.

What this will do is to generate specialized methods for these
primitive types. You can inspect the generated interface easily with
the `javap` utility. For instance, let's see what it generates for
`compareAndSet`:

```scala
$ javap shifter.concurrency.atomic.Ref | grep compareAndSet
  public abstract boolean compareAndSet(T, T);
  public abstract boolean compareAndSet$mcZ$sp(boolean, boolean);
  public abstract boolean compareAndSet$mcI$sp(int, int);
  public abstract boolean compareAndSet$mcJ$sp(long, long);
```

Or for `incrementAndGet`:

```scala
$ javap shifter.concurrency.atomic.Ref | grep incrementAndGet
  public abstract T incrementAndGet(scala.math.Numeric<T>);
  public abstract boolean incrementAndGet$mcZ$sp(scala.math.Numeric<java.lang.Object>);
  public abstract int incrementAndGet$mcI$sp(scala.math.Numeric<java.lang.Object>);
  public abstract long incrementAndGet$mcJ$sp(scala.math.Numeric<java.lang.Object>);
```

So it's basically method overloading done by the Scala
compiler. Clearly this adds some overhead in the generated .class
files and it might not do what you think it does, so use it only if
you really need it.

As I was saying in the beginning, make sure to also (**links update March 31, 2014**):

* see the code in [project Monifu](https://github.com/alexandru/monifu)
* checkout the [API docs](http://www.monifu.org/monifu-core/current/api/#monifu.concurrent.atomic.package)

Also, you may be interested in using
**[scala-stm](http://nbronson.github.io/scala-stm/)**, a library for
*shared transactional memory*, that basically gives you the ability to
orchestrate multiple atomic references at once.
